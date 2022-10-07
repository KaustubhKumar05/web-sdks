import EventEmitter from 'eventemitter2';
import { v4 as uuid } from 'uuid';
import HMSConnection from '../HMSConnection';
import { ISignal } from '../../signal/ISignal';
import ISubscribeConnectionObserver from './ISubscribeConnectionObserver';
import { HMSConnectionRole } from '../model';
import HMSRemoteStream from '../../media/streams/HMSRemoteStream';
import HMSDataChannel from '../HMSDataChannel';
import { API_DATA_CHANNEL } from '../../utils/constants';
import { HMSRemoteAudioTrack } from '../../media/tracks/HMSRemoteAudioTrack';
import { HMSRemoteVideoTrack } from '../../media/tracks/HMSRemoteVideoTrack';
import HMSLogger from '../../utils/logger';
import { getSdpTrackIdForMid } from '../../utils/session-description';
import { PreferAudioLayerParams, PreferLayerResponse, PreferVideoLayerParams } from '../channel-messages';
import { sleep } from '../../utils/timer-utils';

export default class HMSSubscribeConnection extends HMSConnection {
  private readonly TAG = '[HMSSubscribeConnection]';
  private readonly remoteStreams = new Map<string, HMSRemoteStream>();

  private readonly observer: ISubscribeConnectionObserver;
  private readonly MAX_RETRIES = 3;

  readonly nativeConnection: RTCPeerConnection;

  private pendingMessageQueue: string[] = [];

  private apiChannel?: HMSDataChannel;
  private eventEmitter = new EventEmitter();

  private initNativeConnectionCallbacks() {
    this.nativeConnection.oniceconnectionstatechange = () => {
      this.observer.onIceConnectionChange(this.nativeConnection.iceConnectionState);
    };

    // @TODO(eswar): Remove this. Use iceconnectionstate change with interval and threshold.
    this.nativeConnection.onconnectionstatechange = () => {
      this.observer.onConnectionStateChange(this.nativeConnection.connectionState);
    };

    this.nativeConnection.ondatachannel = e => {
      if (e.channel.label !== API_DATA_CHANNEL) {
        // TODO: this.observer.onDataChannel(e.channel);
        return;
      }

      this.apiChannel = new HMSDataChannel(
        e.channel,
        {
          onMessage: (value: string) => {
            this.eventEmitter.emit('message', value);
            this.observer.onApiChannelMessage(value);
          },
        },
        `role=${this.role}`,
      );

      e.channel.onopen = this.handlePendingApiMessages;
    };

    this.nativeConnection.onicecandidate = e => {
      if (e.candidate !== null) {
        this.signal.trickle(this.role, e.candidate);
      }
    };

    this.nativeConnection.ontrack = e => {
      const stream = e.streams[0];
      const streamId = stream.id;
      if (!this.remoteStreams.has(streamId)) {
        const remote = new HMSRemoteStream(stream, this);
        this.remoteStreams.set(streamId, remote);

        stream.onremovetrack = e => {
          /*
           * this match has to be with nativetrack.id instead of track.trackId as the latter refers to sdp track id for
           * ease of correlating update messages coming from the backend. The two track ids are usually the same, but
           * can be different for some browsers. checkout sdptrackid field in HMSTrack for more details.
           */
          const toRemoveTrackIdx = remote.tracks.findIndex(track => track.nativeTrack.id === e.track.id);
          if (toRemoveTrackIdx >= 0) {
            const toRemoveTrack = remote.tracks[toRemoveTrackIdx];
            this.observer.onTrackRemove(toRemoveTrack);
            remote.tracks.splice(toRemoveTrackIdx, 1);

            // If the length becomes 0 we assume that stream is removed entirely
            if (remote.tracks.length === 0) {
              this.remoteStreams.delete(streamId);
            }
          }
        };
      }

      const remote = this.remoteStreams.get(streamId)!;
      const TrackCls = e.track.kind === 'audio' ? HMSRemoteAudioTrack : HMSRemoteVideoTrack;
      const track = new TrackCls(remote, e.track);
      const trackId = getSdpTrackIdForMid(this.remoteDescription, e.transceiver?.mid);
      trackId && track.setSdpTrackId(trackId);
      remote.tracks.push(track);
      this.observer.onTrackAdd(track);
    };
  }

  constructor(signal: ISignal, config: RTCConfiguration, observer: ISubscribeConnectionObserver) {
    super(HMSConnectionRole.Subscribe, signal);
    this.observer = observer;

    this.nativeConnection = new RTCPeerConnection(config);
    this.initNativeConnectionCallbacks();
  }

  sendOverApiDataChannel(message: string) {
    if (this.apiChannel && this.apiChannel.readyState === 'open') {
      this.apiChannel.send(message);
    } else {
      HMSLogger.w(this.TAG, `API Data channel not ${this.apiChannel ? 'open' : 'present'}, queueing`, message);
      this.pendingMessageQueue.push(message);
    }
  }

  async sendOverApiDataChannelWithResponse<T extends PreferAudioLayerParams | PreferVideoLayerParams>(
    message: T,
    requestId?: string,
  ): Promise<PreferLayerResponse> {
    const id = uuid();
    const request = JSON.stringify({
      id: requestId || id,
      jsonrpc: '2.0',
      ...message,
    });
    return this.sendMessage(request, id);
  }

  async close() {
    await super.close();
    this.apiChannel?.close();
  }

  private handlePendingApiMessages = () => {
    if (this.pendingMessageQueue.length > 0) {
      HMSLogger.d(this.TAG, 'Found pending message queue, sending messages');
      this.pendingMessageQueue.forEach(msg => this.sendOverApiDataChannel(msg));
      this.pendingMessageQueue.length = 0;
    }
  };

  private sendMessage = async (request: string, requestId: string): Promise<PreferLayerResponse> => {
    if (this.apiChannel?.readyState === 'open') {
      let response: PreferLayerResponse;
      for (let i = 0; i < this.MAX_RETRIES; i++) {
        this.apiChannel.send(request);
        response = await this.waitForResponse(requestId);
        const error = response.error;
        if (error) {
          HMSLogger.e(this.TAG, `Failed sending ${requestId}`, { request, try: i + 1, error });
          const shouldRetry = error.code / 100 === 5 || error.code === 429;
          if (!shouldRetry) {
            throw Error(`code=${error.code}, message=${error.message}`);
          }
          const delay = (2 + Math.random() * 2) * 1000;
          await sleep(delay);
        } else {
          break;
        }
      }
      return response!;
    } else {
      await sleep(1000);
      return this.sendMessage(request, requestId);
    }
  };

  private waitForResponse = (requestId: string): Promise<PreferLayerResponse> => {
    return new Promise((resolve, reject) => {
      this.eventEmitter.on('message', (value: string) => {
        if (value.includes(requestId)) {
          const response = JSON.parse(value);
          if (response.error) {
            reject(response.error);
            return;
          }
          HMSLogger.d(this.TAG, `response for ${requestId} -`, JSON.stringify(response, null, 2));
          resolve(response);
        }
      });
    });
  };
}
