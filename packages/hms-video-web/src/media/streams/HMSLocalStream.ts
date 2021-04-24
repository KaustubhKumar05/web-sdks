import HMSMediaStream from './HMSMediaStream';
import HMSTrack from '../tracks/HMSTrack';
import HMSTrackSettings from '../settings/HMSTrackSettings';
import HMSLocalAudioTrack from '../tracks/HMSLocalAudioTrack';
import HMSLocalVideoTrack from '../tracks/HMSLocalVideoTrack';
import HMSPublishConnection from '../../connection/publish';
import HMSVideoTrackSettings from '../settings/HMSVideoTrackSettings';
import HMSLogger from '../../utils/logger';

const TAG = 'HMSLocalStream';

/** @internal */
export default class HMSLocalStream extends HMSMediaStream {
  /** Connection set when publish is called for the first track */
  private connection: HMSPublishConnection | null = null;

  setConnection(connection: HMSPublishConnection) {
    this.connection = connection;
  }

  constructor(nativeStream: MediaStream) {
    super(nativeStream);
  }

  static async getLocalScreen(settings: HMSVideoTrackSettings) {
    const constraints = {
      video: settings.toConstraints(),
      audio: false,
    } as MediaStreamConstraints;
    // @ts-ignore [https://github.com/microsoft/TypeScript/issues/33232]
    const stream = (await navigator.mediaDevices.getDisplayMedia(constraints)) as MediaStream;
    const local = new HMSLocalStream(stream);
    const nativeTrack = stream.getVideoTracks()[0];
    const track = new HMSLocalVideoTrack(local, nativeTrack, settings);

    HMSLogger.v(TAG, 'getLocalScreen', track);
    return track;
  }

  static async getLocalTracks(settings: HMSTrackSettings) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: settings.audio != null ? settings.audio!.toConstraints() : false,
      video: settings.video != null ? settings.video!.toConstraints() : false,
    });

    // TODO: Handle error cases, wrap in `HMSException` and throw it
    const local = new HMSLocalStream(stream);
    const tracks: Array<HMSTrack> = [];
    if (settings.audio != null) {
      const nativeTrack = stream.getAudioTracks()[0];
      const track = new HMSLocalAudioTrack(local, nativeTrack, settings.audio);
      tracks.push(track);
    }

    if (settings.video != null) {
      const nativeTrack = stream.getVideoTracks()[0];
      const track = new HMSLocalVideoTrack(local, nativeTrack, settings.video);
      tracks.push(track);
    }

    HMSLogger.v(TAG, 'getLocalTracks', tracks);
    return tracks;
  }

  // TODO: Add static method to get screen-share (similar to getLocalTracks)

  addTransceiver(track: HMSTrack) {
    // TODO: Add support for simulcast
    const transceiver = this.connection!.addTransceiver(track.nativeTrack, {
      streams: [this.nativeStream],
      direction: 'sendonly',
      sendEncodings: undefined, // TODO
    });
    this.setPreferredCodec(transceiver, track.nativeTrack.kind);
    return transceiver;
  }

  async setMaxBitrate(maxBitrate: number, track: HMSTrack) {
    await this.connection?.setMaxBitrate(maxBitrate, track);
  }

  // @ts-ignore
  setPreferredCodec(transceiver: RTCRtpTransceiver, kind: string) {
    // TODO: Some browsers don't support setCodecPreferences, resort to SDPMunging?
  }

  async replaceTrack(track: HMSTrack, withTrack: MediaStreamTrack) {
    const sender = this.connection!.getSenders().find((sender) => sender.track && sender.track!.id === track.trackId);

    if (sender === undefined) throw Error(`No sender found for trackId=${track.trackId}`);
    this.nativeStream.removeTrack(track.nativeTrack);
    sender.track!.stop(); // If the track is already stopped, this does not throw any error. 😉

    await sender.replaceTrack(withTrack);
    this.nativeStream.addTrack(withTrack);

    track.nativeTrack = withTrack;
  }

  removeSender(track: HMSTrack) {
    let removedSenderCount = 0;
    this.connection!.getSenders().forEach((sender) => {
      if (sender.track && sender.track.id === track.trackId) {
        this.connection!.removeTrack(sender);
        removedSenderCount += 1;

        // Remove the local reference as well
        const toRemoveLocalTrackIdx = this.tracks.indexOf(track);
        if (toRemoveLocalTrackIdx !== -1) {
          this.tracks.splice(toRemoveLocalTrackIdx, 1);
        } else throw Error(`Cannot find ${track} in locally stored tracks`);
      }
    });
    if (removedSenderCount != 1) {
      throw Error(`Removed ${removedSenderCount} sender's, expected to remove 1`);
    }
  }
}
