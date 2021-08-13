import { HMSConfig } from './config';
import HMSUpdateListener, { HMSAudioListener } from './update-listener';
import { HMSMessage } from './message';
import { HMSLogLevel } from '../utils/logger';
import { HMSAnalyticsLevel } from '../analytics/AnalyticsEventLevel';
import { HMSRemoteTrack, HMSTrackSource } from '../media/tracks';
import { HMSLocalPeer, HMSPeer, HMSRemotePeer } from './peer';
import { HMSRole } from './role';
import { HMSPreviewListener } from './preview-listener';
import { IAudioOutputManager } from '../device-manager/AudioOutputManager';
import { HMSRoleChangeRequest } from './role-change-request';

export default interface HMS {
  preview(config: HMSConfig, listener: HMSPreviewListener): void;
  join(config: HMSConfig, listener: HMSUpdateListener): void;
  leave(): Promise<void>;

  getLocalPeer(): HMSLocalPeer | undefined;
  getPeers(): HMSPeer[];
  getRoles(): HMSRole[];
  getAudioOutput(): IAudioOutputManager;

  changeRole(forPeer: HMSRemotePeer, toRole: string, force?: boolean): void;
  acceptChangeRole(request: HMSRoleChangeRequest): void;

  changeTrackState(forRemoteTrack: HMSRemoteTrack, enabled: boolean): Promise<void>;
  removePeer(peer: HMSRemotePeer, reason: string): Promise<void>;
  endRoom(lock: boolean, reason: string): Promise<void>;

  /**
   * @deprecated The method should not be used
   * @see sendBroadcastMessage
   */
  sendMessage(type: string, message: string): HMSMessage | void;
  sendBroadcastMessage(message: string, type?: string): HMSMessage | void;
  sendGroupMessage(message: string, roles: HMSRole[], type?: string): HMSMessage | void;
  sendDirectMessage(message: string, peer: HMSPeer, type?: string): HMSMessage | void;

  startScreenShare(onStop: () => void): Promise<void>;
  stopScreenShare(): Promise<void>;

  addTrack(track: MediaStreamTrack, source: HMSTrackSource): Promise<void>;
  removeTrack(trackId: string): Promise<void>;

  setLogLevel(level: HMSLogLevel): void;
  setAnalyticsLevel(level: HMSAnalyticsLevel): void;
  addAudioListener(listener: HMSAudioListener): void;
}
