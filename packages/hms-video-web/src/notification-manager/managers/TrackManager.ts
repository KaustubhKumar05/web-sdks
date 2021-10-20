import { EventEmitter } from 'events';
import { HMSTrackUpdate, HMSUpdateListener } from '../../interfaces';
import { HMSRemoteAudioTrack, HMSRemoteTrack, HMSRemoteVideoTrack, HMSTrackType } from '../../media/tracks';
import { IStore } from '../../sdk/store';
import HMSLogger from '../../utils/logger';
import { TrackStateNotification } from '../HMSNotifications';

/**
 * Handles:
 * - Incoming track meta-data from BIZ(signal) to match a track to a peer.
 * - Incoming MediaStreamTracks(wrapped in HMSTracks) from RTCMediaChannel.
 * - Mute/unmute track meta-data updates from BIZ.
 *
 * Since track meta-data and RTC tracks come in asynchronously,
 * we store the track meta-data(TrackState) in SDK Store and tracks temporarily here in tracksToProcess.
 *
 * Once we have both TrackState and track,
 * we add it to peer, send listener.onTrackUpdate and remove it from tracksToProcess.
 *
 * Gotchas:
 * - TRACK_UPDATE comes before TRACK_ADD -> update state, process pending tracks when TRACK_ADD arrives.
 */
export class TrackManager {
  private tracksToProcess: Map<string, HMSRemoteTrack> = new Map();

  private get TAG() {
    return `[${this.constructor.name}]`;
  }

  constructor(private store: IStore, private eventEmitter: EventEmitter, public listener?: HMSUpdateListener) {}

  handleTrackMetadataAdd(params: TrackStateNotification) {
    HMSLogger.d(this.TAG, `TRACK_METADATA_ADD`, params);

    for (const trackId in params.tracks) {
      this.store.setTrackState({
        peerId: params.peer.peer_id,
        trackInfo: params.tracks[trackId],
      });
    }

    this.processPendingTracks();
  }

  /**
   * Sets the tracks to peer and returns the peer
   */
  handleTrackAdd = (track: HMSRemoteTrack) => {
    HMSLogger.d(this.TAG, `ONTRACKADD`, track, track.nativeTrack);
    this.store.addTrack(track);
    this.tracksToProcess.set(track.trackId, track);
    this.processPendingTracks();
  };

  /**
   * Sets the track of corresponding peer to null and returns the peer
   */
  handleTrackRemove = (track: HMSRemoteTrack) => {
    HMSLogger.d(this.TAG, `ONTRACKREMOVE`, track, track.nativeTrack);
    const trackStateEntry = this.store.getTrackState(track.trackId);

    if (!trackStateEntry) return;

    // emit this event here as peer will already be removed(if left the room) by the time this event is received
    track.type === HMSTrackType.AUDIO && this.eventEmitter.emit('track-removed', { detail: track });
    const hmsPeer = this.store.getPeerById(trackStateEntry.peerId);
    if (!hmsPeer) {
      return;
    }

    const removeAuxiliaryTrack = () => {
      const auxiliaryTrackIndex = hmsPeer.auxiliaryTracks.indexOf(track);
      if (auxiliaryTrackIndex > -1) {
        hmsPeer.auxiliaryTracks.splice(auxiliaryTrackIndex, 1);
      }
    };

    switch (track.type) {
      case HMSTrackType.AUDIO:
        if (track.source !== 'regular') {
          removeAuxiliaryTrack();
        } else {
          hmsPeer.audioTrack = undefined;
        }
        break;
      case HMSTrackType.VIDEO: {
        if (track.source !== 'regular') {
          removeAuxiliaryTrack();
        } else {
          hmsPeer.videoTrack = undefined;
        }
      }
    }

    this.store.removeTrack(track.trackId);
    this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_REMOVED, track, hmsPeer);
  };

  handleTrackUpdate = (params: TrackStateNotification) => {
    HMSLogger.d(this.TAG, `TRACK_UPDATE`, params);

    const hmsPeer = this.store.getPeerById(params.peer.peer_id);
    if (!hmsPeer) {
      return;
    }

    for (const trackId in params.tracks) {
      const currentTrackStateInfo = Object.assign({}, this.store.getTrackState(trackId)?.trackInfo);

      const trackEntry = params.tracks[trackId];
      const track = this.store.getTrackById(trackId);

      this.store.setTrackState({
        peerId: params.peer.peer_id,
        trackInfo: { ...currentTrackStateInfo, ...trackEntry },
      });

      // TRACK_UPDATE came before TRACK_ADD -> update state, process pending tracks when TRACK_ADD arrives.
      if (!track || this.tracksToProcess.has(trackId)) {
        this.processPendingTracks();
      } else {
        track.setEnabled(!trackEntry.mute);
        if (currentTrackStateInfo.mute !== trackEntry.mute) {
          if (trackEntry.mute) {
            this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_MUTED, track, hmsPeer);
          } else {
            this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_UNMUTED, track, hmsPeer);
          }
          track.type === HMSTrackType.AUDIO &&
            this.eventEmitter.emit('track-updated', { detail: { track, enabled: !trackEntry.mute } });
        } else if (currentTrackStateInfo.description !== trackEntry.description) {
          this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_DESCRIPTION_CHANGED, track, hmsPeer);
        }
      }
    }
  };

  processPendingTracks() {
    const tracksCopy = new Map(this.tracksToProcess);

    tracksCopy.forEach((track) => {
      const state = this.store.getTrackState(track.trackId);
      if (!state) {
        return;
      }

      const hmsPeer = this.store.getPeerById(state.peerId);
      if (!hmsPeer) {
        return;
      }

      track.source = state.trackInfo.source;
      track.peerId = hmsPeer.peerId;
      track.setEnabled(!state.trackInfo.mute);

      switch (track.type) {
        case HMSTrackType.AUDIO:
          if (!hmsPeer.audioTrack && track.source === 'regular') {
            hmsPeer.audioTrack = track as HMSRemoteAudioTrack;
          } else {
            hmsPeer.auxiliaryTracks.push(track);
          }
          break;
        case HMSTrackType.VIDEO:
          const remoteTrack = track as HMSRemoteVideoTrack;
          const simulcastDefinitions = this.store.getSimulcastDefinitionsForPeer(hmsPeer, remoteTrack.source!);
          remoteTrack.setSimulcastDefinitons(simulcastDefinitions);
          if (!hmsPeer.videoTrack && track.source === 'regular') {
            hmsPeer.videoTrack = remoteTrack;
          } else {
            hmsPeer.auxiliaryTracks.push(remoteTrack);
          }
      }

      /**
       * Don't call onTrackUpdate for audio elements immediately because the operations(eg: setVolume) performed
       * on onTrackUpdate can be overriden in AudioSinkManager when audio element is created
       **/
      track.type === HMSTrackType.AUDIO
        ? this.eventEmitter.emit('track-added', { detail: { track, peer: hmsPeer } })
        : this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_ADDED, track, hmsPeer);
      this.tracksToProcess.delete(track.trackId);
    });
  }
}
