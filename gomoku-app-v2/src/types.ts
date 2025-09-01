export type Player = 'black' | 'white';
export type GameMode = 'pvp' | 'pva' | 'pvo';
export type GameState = 'waiting' | 'playing' | 'post-game' | 'replay';
export type Profile = {
  id: string;
  username: string;
  elo_rating: number;
  is_supporter: boolean;
  nickname_color: string | null;
  badge_color: string | null;
};
export type Game = {
  id: number;
  moves: { player: Player, row: number, col: number }[];
  game_type: GameMode;
};
export type EmoticonMessage = {
  id: number;
  fromId: string;
  emoticon: string;
};
