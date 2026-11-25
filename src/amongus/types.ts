// ============================================================
// Blade X — Among Us Manager · Types
// ============================================================

export type AmongUsPhase = 'waiting' | 'in_game' | 'meeting' | 'round_ended' | 'ended';
export type AmongUsSessionStatus = 'active' | 'ended';
export type AmongUsPlayerStatus = 'alive' | 'dead' | 'pending';

export interface AmongUsSettings {
  guild_id: string;
  voice_channel_id: string | null;
  control_channel_id: string | null;
  control_message_id: string | null;
  host_role_ids: string;
  helper_role_ids: string;
  log_channel_id: string | null;
  setup_completed: number;
  created_at: number;
  updated_at: number;
}

export interface AmongUsSession {
  session_id: string;
  guild_id: string;
  host_user_id: string;
  status: AmongUsSessionStatus;
  current_phase: AmongUsPhase;
  voice_channel_id: string | null;
  control_channel_id: string | null;
  control_message_id: string | null;
  last_action: string | null;
  recovery_mode: number;
  created_at: number;
  updated_at: number;
  ended_at: number | null;
}

export interface AmongUsPlayer {
  session_id: string;
  guild_id: string;
  user_id: string;
  display_name: string | null;
  player_status: AmongUsPlayerStatus;
  is_connected: number;
  original_server_mute: number;
  bot_managed_mute: number;
  external_override: number;
  expected_server_mute: number;
  restore_on_rejoin: number;
  last_updated: number;
}

export interface AmongUsHelperRow {
  session_id: string;
  guild_id: string;
  user_id: string;
  added_by: string | null;
  created_at: number;
}

export interface AmongUsEventRow {
  id: number;
  session_id: string | null;
  guild_id: string;
  actor_user_id: string | null;
  action: string;
  target_user_id: string | null;
  previous_state: string | null;
  new_state: string | null;
  created_at: number;
}

export const PHASE_LABELS: Record<AmongUsPhase, string> = {
  waiting: '🟡 Waiting for Players',
  in_game: '🔴 In Game',
  meeting: '🟡 Meeting',
  round_ended: '🟢 Round Ended',
  ended: '⚪ Session Ended',
};

export const PHASE_COLORS: Record<AmongUsPhase, number> = {
  waiting: 0x5865f2,
  in_game: 0xed4245,
  meeting: 0xfee75c,
  round_ended: 0x57f287,
  ended: 0x747f8d,
};

export const PLAYER_STATUS_LABELS: Record<AmongUsPlayerStatus, string> = {
  alive: '🟢 Alive',
  dead: '💀 Dead',
  pending: '🟡 Pending',
};
