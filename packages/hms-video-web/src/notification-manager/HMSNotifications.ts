import { HMSTrack, HMSTrackSource } from '../media/tracks/HMSTrack';
import { HMSRole } from '../interfaces/role';
import { Track } from '../signal/interfaces';

/**
 * Interfaces for message received from BIZ Signal through Websocket.
 * These messages are handled by NotificationManager
 * which will call the corresponding HMSUpdateListener callbacks.
 */

export interface TrackStateNotification {
  tracks: {
    [track_id: string]: TrackState;
  };
  peer: PeerNotificationInfo;
}

export interface PeerNotificationInfo {
  peer_id: string;
  info: Info;
}

export interface Info {
  name: string;
  data: string;
  user_id: string;
}

export interface PolicyParams {
  name: string;
  known_roles: {
    [role: string]: HMSRole;
  };
}

export class TrackState implements Track {
  mute: boolean;
  type: 'audio' | 'video';
  source: HMSTrackSource;
  description: string;
  track_id: string;
  stream_id: string;

  constructor(track: HMSTrack | Track) {
    this.type = track.type;
    this.source = track.source || 'regular';
    this.description = '';
    if (track instanceof HMSTrack) {
      this.mute = !track.enabled;
      this.track_id = track.trackId;
      this.stream_id = track.stream.id;
    } else {
      this.mute = track.mute;
      this.track_id = track.track_id;
      this.stream_id = track.stream_id;
    }
  }
}

export interface PeerNotification {
  peer_id: string;
  info: Info;
  role: string;
  tracks: {
    [track_id: string]: TrackState;
  };
}

export interface PeerListNotification {
  peers: {
    [peer_id: string]: PeerNotification;
  };
}

interface Speaker {
  peer_id: string;
  track_id: string;
  level: number;
}

export interface SpeakerList {
  'speaker-list': Speaker[];
}

/**
 * Represents the role change request received from the server
 */
export interface RoleChangeRequestParams {
  requested_by: string;
  role: string;
  token: string;
}

export interface TrackUpdateRequestNotification {
  requested_by: string;
  track_id: string;
  stream_id: string;
  mute: boolean;
}

export interface PeerLeaveRequestNotification {
  requested_by: string;
  reason: string;
  room_end: boolean;
}

export interface MessageNotification {
  peer: {
    peer_id: string;
    info: {
      name: string;
      data: any;
      user_id: string;
    };
  };
  roles?: string[];
  private: boolean;
  timestamp: number;
  info: MessageNotificationInfo;
}

export interface SendMessage {
  info: MessageNotificationInfo;
  roles?: string[];
  peer_id?: string;
}

export interface MessageNotificationInfo {
  sender: string;
  message: any;
  type: string;
  time?: string;
}