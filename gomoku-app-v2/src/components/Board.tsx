'use client';

import { useState, useEffect, useRef, useCallback, Dispatch, SetStateAction } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import io, { Socket } from 'socket.io-client';
import { useTranslation } from 'react-i18next';
import type { GameMode, GameState, Profile, Game, EmoticonMessage, Player } from '../types';
import GameEndModal from './GameEndModal';
import PostGameManager from './PostGameManager';
import OnlineMultiplayerMenu from './OnlineMultiplayerMenu';
import ReplayControls from './ReplayControls';
import PlayerDisplay from './PlayerDisplay';
import EmoticonPicker from './EmoticonPicker';
import RoomCodeModal from './RoomCodeModal';
import PvaBackground from './PvaBackground';
import { findForbiddenMoves } from '../lib/gomokuRules';
import RuleInfo from './RuleInfo';

const BOARD_SIZE = 19;
const K_FACTOR = 32;
const INITIAL_TIME = 5000;
const PRIVATE_INITIAL_TIME = 10000;
const INCREMENT_TIME = 1000;
const MAX_TIME_PVO = 30000;
const MAX_TIME_PVA = 60000;

interface GameData {
  game_type: GameMode;
  winner_player: Player;
  moves: { player: Player; row: number; col: number; }[];
  player_black_id?: string | null;
  player_white_id?: string | null;
}

const checkWin = (board: (Player | null)[][], player: Player, row: number, col: number): {row: number, col: number}[] | null => {
  const directions = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: -1 }];
  for (const dir of directions) {
    const line = [{row, col}];
    let count = 1;
    for (let i = 1; i < 5; i++) {
      const newRow = row + i * dir.y; const newCol = col + i * dir.x;
      if (newRow < 0 || newRow >= BOARD_SIZE || newCol < 0 || newCol >= BOARD_SIZE || board[newRow][newCol] !== player) break;
      line.push({row: newRow, col: newCol});
      count++;
    }
    for (let i = 1; i < 5; i++) {
      const newRow = row - i * dir.y; const newCol = col - i * dir.x;
      if (newRow < 0 || newRow >= BOARD_SIZE || newCol < 0 || newCol >= BOARD_SIZE || board[newRow][newCol] !== player) break;
      line.push({row: newRow, col: newCol});
      count++;
    }
    if (count >= 5) {
        return line.slice(0, 5);
    }
  }
  return null;
};

const calculateElo = (playerRating: number, opponentRating: number, score: 1 | 0 | 0.5) => {
  const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
  return Math.round(playerRating + K_FACTOR * (score - expectedScore));
};

const formatDuration = (seconds: number, t: (key: string, fallback: string) => string) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}${t('minute', '분')} ${remainingSeconds}${t('second', '초')}`;
}

const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    const milliseconds = Math.floor((ms % 1000) / 100).toString();
    return `${seconds}.${milliseconds}`;
}

interface BoardProps {
    initialGameMode: GameMode;
    onExit: () => void;
    spectateRoomId?: string | null;
    replayGame?: Game | null;
}
const Board = ({ initialGameMode, onExit, spectateRoomId = null, replayGame = null }: BoardProps) => {
    const { t } = useTranslation();
    const [board, setBoard] = useState<Array<Array<Player | null>>>(Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)));
    const [currentPlayer, setCurrentPlayer] = useState<Player>('black');
    const [winner, setWinner] = useState<Player | null>(null);
    const [gameMode, setGameMode] = useState<GameMode>(initialGameMode);
    const [gameState, setGameState] = useState<GameState>(replayGame ? 'replay' : 'waiting');
    const [room, setRoom] = useState(spectateRoomId || '');
    const [playerRole, setPlayerRole] = useState<Player | null>(null);
    const [isSpectator, setIsSpectator] = useState(!!spectateRoomId);
    const [history, setHistory] = useState(replayGame ? replayGame.moves : []);
    const [userProfile, setUserProfile] = useState<Profile | null>(null);
    const [opponentProfile, setOpponentProfile] = useState<Profile | null>(null);
    const [onlineUsers, setOnlineUsers] = useState(0);
    const [inQueueUsers, setInQueueUsers] = useState(0);
    const [createdRoomId, setCreatedRoomId] = useState<string | null>(null);
    const [showRoomCodeModal, setShowRoomCodeModal] = useState(false);
    const [isSocketConnected, setIsSocketConnected] = useState(false);
    const [isPrivateGame, setIsPrivateGame] = useState(false);
    const [replayMoveIndex, setReplayMoveIndex] = useState(0);
    const [isReplaying, setIsReplaying] = useState(false);
    const [whatIfState, setWhatIfState] = useState<{board: (Player | null)[][], player: Player} | null>(null);
    const [aiKnowledge, setAiKnowledge] = useState<Map<string, { wins: number; losses: number; }> | null>(null);
    const [aiPlayer, setAiPlayer] = useState<Player>('white');
    const [winningLine, setWinningLine] = useState<{row: number, col: number}[] | null>(null);
    const [startTime, setStartTime] = useState<number | null>(null);
    const [gameDuration, setGameDuration] = useState("");

    const [activeEmoticon, setActiveEmoticon] = useState<{ id: number, fromId: string, emoticon: string } | null>(null);
    const [emoticonCooldown, setEmoticonCooldown] = useState(false);

    const [turnTimeLimit, setTurnTimeLimit] = useState(INITIAL_TIME);
    const [turnTimeRemaining, setTurnTimeRemaining] = useState(INITIAL_TIME);
    const [forbiddenMoves, setForbiddenMoves] = useState<{row: number, col: number}[]>([]);
    
    const { user } = useAuth();
    const socketRef = useRef<Socket | null>(null);
    const aiWorkerRef = useRef<Worker | null>(null);
    const replayIntervalRef = useRef<number | null>(null);
    const opponentProfileRef = useRef(opponentProfile);
    opponentProfileRef.current = opponentProfile;
    const isInitialMount = useRef(true);

    const internalReset = () => {
        setBoard(Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)));
        setCurrentPlayer('black');
        setWinner(null);
        setHistory([]);
        setGameState('waiting');
        setWhatIfState(null);
        setWinningLine(null);
        setStartTime(Date.now());
        const initialTime = isPrivateGame ? PRIVATE_INITIAL_TIME : INITIAL_TIME;
        setTurnTimeLimit(initialTime);
        setTurnTimeRemaining(initialTime);
        setForbiddenMoves([]);
    };

    const handleStonePlacement = useCallback((row: number, col: number) => {
        if (whatIfState) {
            return;
        }

        if (board[row][col] || winner || isSpectator || gameState !== 'playing') return;
        if (gameMode === 'pvo' && currentPlayer !== playerRole) { toast.error(t('NotYourTurn')); return; }

        if (currentPlayer === 'black' && forbiddenMoves.some(m => m.row === row && m.col === col)) {
            toast.error(t('ForbiddenMove', 'This move is forbidden (3-3 or 4-4).'));
            return;
        }

        const newBoard = board.map(r => [...r]);
        newBoard[row][col] = currentPlayer;
        const newHistory = [...history, { player: currentPlayer, row, col }];
        setBoard(newBoard);
        setHistory(newHistory);

        const winInfo = checkWin(newBoard, currentPlayer, row, col);
        if (winInfo) {
            setWinner(currentPlayer);
            setWinningLine(winInfo);
            if(startTime) {
                const durationInSeconds = (Date.now() - startTime) / 1000;
                setGameDuration(formatDuration(durationInSeconds, t));
            }
            setGameState('post-game');
            
            if (gameMode === 'pvo') socketRef.current?.emit('game-over', { roomId: room, winner: currentPlayer });
        } else {
            const newPlayer = currentPlayer === 'black' ? 'white' : 'black';
            setCurrentPlayer(newPlayer);
            
            let newLimit = turnTimeLimit + INCREMENT_TIME;
            const maxTime = gameMode === 'pva' ? MAX_TIME_PVA : MAX_TIME_PVO;
            newLimit = Math.min(newLimit, maxTime);

            setTurnTimeLimit(newLimit);
            setTurnTimeRemaining(newLimit);
        }
    }, [board, currentPlayer, gameState, gameMode, isSpectator, playerRole, room, winner, whatIfState, aiKnowledge, t, history, startTime, turnTimeLimit, forbiddenMoves]);

    // Create a ref for the handler to give the worker access to the latest version
    const handleStonePlacementRef = useRef(handleStonePlacement);
    useEffect(() => {
        handleStonePlacementRef.current = handleStonePlacement;
    });

    // Timer Countdown Effect
    useEffect(() => {
        const timerApplies = (gameMode === 'pvo' || gameMode === 'pva') && gameState === 'playing' && !winner;
        if (!timerApplies) return;

        const timer = setInterval(() => {
            setTurnTimeRemaining(prev => {
                if (prev <= 100) {
                    clearInterval(timer);
                    const timeoutWinner = currentPlayer === 'black' ? 'white' : 'black';
                    setWinner(timeoutWinner);
                    setGameState('post-game');
                    toast.error(t(currentPlayer === 'black' ? 'BlackTimeout' : 'WhiteTimeout', `${currentPlayer} ran out of time!`));
                    return 0;
                }
                return prev - 100;
            });
        }, 100);

        return () => clearInterval(timer);
    }, [gameState, currentPlayer, gameMode, winner, t]);

    // Forbidden Move Calculation Effect
    useEffect(() => {
        if (gameMode === 'pvo' && currentPlayer === 'black' && gameState === 'playing') {
            const moves = findForbiddenMoves(board, 'black');
            setForbiddenMoves(moves);
        } else {
            setForbiddenMoves([]);
        }
    }, [board, currentPlayer, gameMode, gameState]);


    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            if (initialGameMode === 'pva' && !replayGame && !spectateRoomId) {
                const randomAiPlayer = Math.random() < 0.5 ? 'black' : 'white';
                setAiPlayer(randomAiPlayer);
                setGameState('playing');
            }
            return;
        }

        setGameMode(initialGameMode);
        internalReset();
        if (initialGameMode === 'pva' && !replayGame && !spectateRoomId) {
            const randomAiPlayer = Math.random() < 0.5 ? 'black' : 'white';
            setAiPlayer(randomAiPlayer);
            setGameState('playing');
        }
    }, [initialGameMode, replayGame, spectateRoomId]);

    const handleGameEnd = useCallback(async (gameWinner: Player) => {
        if (isSpectator || gameMode === 'pvp') return;
        let gameData: GameData = { game_type: gameMode, winner_player: gameWinner, moves: history };
        if (gameMode === 'pvo' && userProfile && opponentProfile) {
            gameData.player_black_id = playerRole === 'black' ? userProfile.id : opponentProfile.id;
            gameData.player_white_id = playerRole === 'white' ? userProfile.id : opponentProfile.id;
        } else if (gameMode === 'pva' && userProfile) {
            if (aiPlayer === 'white') {
                gameData.player_black_id = userProfile.id;
                gameData.player_white_id = null;
            } else {
                gameData.player_black_id = null;
                gameData.player_white_id = userProfile.id;
            }
        }
        const { data: savedGame, error: gameSaveError } = await supabase.from('games').insert([gameData]).select().single();
        if (gameSaveError || !savedGame) { toast.error(t('FailedToSaveGame')); return; }
        else {
            toast.success(t('GameResultsSaved'));
            if (userProfile?.is_supporter) await supabase.rpc('add_replay_and_prune', { user_id_in: userProfile.id, game_id_in: savedGame.id });
            if (opponentProfile?.is_supporter) await supabase.rpc('add_replay_and_prune', { user_id_in: opponentProfile.id, game_id_in: savedGame.id });
        }
        if (gameMode === 'pvo' && userProfile && opponentProfile) {
            const didIWin = playerRole === gameWinner;
            const myNewElo = calculateElo(userProfile.elo_rating ?? 1500, opponentProfile.elo_rating ?? 1500, didIWin ? 1 : 0);
            const opponentNewElo = calculateElo(opponentProfile.elo_rating ?? 1500, userProfile.elo_rating ?? 1500, didIWin ? 0 : 1);
            toast.success(`${t('YourNewElo')}: ${myNewElo} (${myNewElo - userProfile.elo_rating >= 0 ? '+' : ''}${myNewElo - userProfile.elo_rating})`);
            await supabase.rpc('update_elo', { winner_id: didIWin ? userProfile.id : opponentProfile.id, loser_id: didIWin ? opponentProfile.id : userProfile.id, winner_new_elo: didIWin
            ? myNewElo : opponentNewElo, loser_new_elo: didIWin ? opponentNewElo : myNewElo });
            setUserProfile(p => p ? { ...p, elo_rating: myNewElo } : null);
            setOpponentProfile(p => p ? { ...p, elo_rating: opponentNewElo } : null);
        }
    }, [isSpectator, gameMode, history, userProfile, opponentProfile, playerRole, t, aiPlayer]);

    useEffect(() => { if (winner && gameState === 'post-game') handleGameEnd(winner); }, [winner, gameState, handleGameEnd]);

    useEffect(() => { const fetchUserProfile = async () => { if (!user) return; const { data, error } = await supabase.from('profiles').select('id, username, elo_rating, is_supporter, nickname_color, badge_color').eq('id', user.id).single(); if (error) console.error('Error fetching user profile:', error); else setUserProfile(data); };
        fetchUserProfile(); }, [user]);

    // AI Worker Effect - runs only once
    useEffect(() => { 
        aiWorkerRef.current = new Worker('/ai.worker.js', { type: 'module' }); 
        aiWorkerRef.current.onmessage = (e) => { 
            const { row, col } = e.data; 
            if (row !== -1 && col !== -1) { 
                handleStonePlacementRef.current(row, col); 
            } 
        }; 
        return () => aiWorkerRef.current?.terminate(); 
    }, []);

    useEffect(() => { const fetchAiKnowledge = async () => { const { data, error } = await supabase.from('ai_knowledge').select('*'); if (error) console.error('Error fetching AI knowledge:', error); else { const knowledgeMap = new Map(data.map(item => [item.pattern_hash, { wins: item.wins, losses: item.losses }])); setAiKnowledge(knowledgeMap); } };
        fetchAiKnowledge(); }, []);

    useEffect(() => { if (gameMode === 'pva' && currentPlayer === aiPlayer && !winner && gameState === 'playing') aiWorkerRef.current?.postMessage({ board, player: currentPlayer,
        knowledge: aiKnowledge }); }, [currentPlayer, gameMode, winner, board, aiKnowledge, aiPlayer, gameState]);
        useEffect(() => {
        if (isReplaying && gameState === 'replay') {
            replayIntervalRef.current = window.setInterval(() => {
                setReplayMoveIndex(prev => {
                    if (prev < history.length - 1) {
                        return prev + 1;
                    }
                    setIsReplaying(false);
                    return prev;
                });
            }, 1000);
        } else {
            if (replayIntervalRef.current) clearInterval(replayIntervalRef.current);
        }
        return () => {
            if (replayIntervalRef.current) clearInterval(replayIntervalRef.current);
        };
    }, [isReplaying, gameState, history.length]);

    useEffect(() => {
        if (gameMode === 'pvo' && userProfile) {
            const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3002';
            const socket = io(socketUrl);
            socketRef.current = socket;

            socket.on('connect', () => {
                setIsSocketConnected(true);
                if (user) socket.emit('authenticate', user.id);
                if (spectateRoomId) socket.emit('join-private-room', spectateRoomId, userProfile);
                else socket.emit('request-user-counts');
            });

            socket.on('disconnect', () => {
                setIsSocketConnected(false);
            });

            socket.on('assign-role', (role) => setPlayerRole(role));
            socket.on('game-start', ({ roomId }) => { 
                setRoom(roomId); 
                const initialTime = isPrivateGame ? PRIVATE_INITIAL_TIME : INITIAL_TIME;
                setTurnTimeLimit(initialTime);
                setTurnTimeRemaining(initialTime);
                setGameState('playing'); 
                toast.success(t('GameStarted')); 
                if (userProfile) socket.emit('share-profile', { room: roomId, profile: userProfile }); 
            });
            socket.on('joined-as-spectator', () => { setIsSpectator(true); setGameState('playing'); });
            socket.on('opponent-profile', (profile) => setOpponentProfile(profile));
            socket.on('game-state-update', ({ move, newPlayer }) => { 
                let newLimit = turnTimeLimit + INCREMENT_TIME;
                // This logic is now correct and only uses the PVO max time.
                newLimit = Math.min(newLimit, MAX_TIME_PVO);
                setTurnTimeLimit(newLimit);
                setTurnTimeRemaining(newLimit);
                setBoard(prevBoard => { const newBoard = prevBoard.map(r => [...r]); newBoard[move.row][move.col] = newPlayer === 'black' ? 'white' : 'black'; return newBoard; }); 
                setCurrentPlayer(newPlayer); 
            });
            socket.on('game-over-update', ({ winner: winnerName }) => { setWinner(winnerName); setGameState('post-game'); });
            socket.on('new-game-starting', () => { toast.success(t('RematchStarting')); internalReset(); });
            socket.on('room-full-or-invalid', () => toast.error(t('RoomFullOrInvalid')));
            socket.on('opponent-disconnected', () => { toast.error(t('OpponentDisconnected')); resetGame(gameMode); });
            socket.on('user-counts-update', ({ onlineUsers, inQueueUsers }) => {
                setOnlineUsers(onlineUsers);
                setInQueueUsers(inQueueUsers);
            });
            socket.on('room-created', (roomId) => {
                setRoom(roomId);
                setCreatedRoomId(roomId);
                setShowRoomCodeModal(true);
                setIsPrivateGame(true);
            });

            const handleNewEmoticon = (data: { fromId: string, emoticon: string }) => {
                setActiveEmoticon({ ...data, id: Date.now() });
            };
            socket.on('new-emoticon', handleNewEmoticon);

            return () => { 
                socket.disconnect();
            };
        }
    }, [gameMode, user, userProfile, spectateRoomId, t, turnTimeLimit, isPrivateGame]);

    useEffect(() => {
        if (activeEmoticon) {
            const timer = setTimeout(() => setActiveEmoticon(null), 2800);
            return () => clearTimeout(timer);
        }
    }, [activeEmoticon]);

    useEffect(() => {
        const isPva = gameMode === 'pva';
        if (isPva) {
            document.body.classList.remove('main-background');
        } else {
            document.body.classList.add('main-background');
        }
        return () => {
            document.body.classList.add('main-background');
        };
    }, [gameMode]);

    const resetGame = (mode: GameMode) => {
        setGameMode(mode);
        internalReset();
    };
    const handleBoardClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (winner || isSpectator || (gameState !== 'playing' && !whatIfState)) return;
        if (gameMode === 'pva' && currentPlayer === aiPlayer) return;

        const rect = event.currentTarget.getBoundingClientRect();
        const gridWidth = event.currentTarget.clientWidth;
        const gridHeight = event.currentTarget.clientHeight;
        const style = window.getComputedStyle(event.currentTarget);
        const paddingLeft = parseFloat(style.paddingLeft);
        const paddingTop = parseFloat(style.paddingTop);

        const x = event.clientX - rect.left - paddingLeft;
        const y = event.clientY - rect.top - paddingTop;

        if (x < 0 || x > gridWidth || y < 0 || y > gridHeight) {
            return;
        }

        const row = Math.round((y / gridHeight) * (BOARD_SIZE - 1));
        const col = Math.round((x / gridWidth) * (BOARD_SIZE - 1));

        if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
            handleStonePlacement(row, col);
        }
    };

    const handleSendEmoticon = (emoticon: string) => { 
        if (emoticonCooldown) return;
        if(userProfile) {
            setActiveEmoticon({ fromId: userProfile.id, emoticon, id: Date.now() });
        }
        socketRef.current?.emit('send-emoticon', { room, emoticon, fromId: userProfile?.id }); 
        setEmoticonCooldown(true);
        setTimeout(() => setEmoticonCooldown(false), 2000);
    };

    const handleWhatIf = () => { if (history.length === 0) { toast.error(t('NoMovesToAnalyze')); return; } if (replayGame?.game_type !== 'pva') { toast.error(t('WhatIfPvaOnly'));
        return; } setIsReplaying(false); const currentReplayBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)); for (let i = 0; i <= replayMoveIndex; i++) {
        currentReplayBoard[history[i].row][history[i].col] = history[i].player; } const nextPlayer = history[replayMoveIndex + 1]?.player || (history[replayMoveIndex].player === 'black' ?
        'white' : 'black'); setWhatIfState({ board: currentReplayBoard, player: nextPlayer }); toast.success(t('WhatIfActivated')); };
    const exitWhatIf = () => setWhatIfState(null);
    const isWinningStone = (row: number, col: number) => {
        return winningLine?.some(stone => stone.row === row && stone.col === col) || false;
    }
    const isLastMove = (row: number, col: number) => {
        if (history.length === 0) return false;
        const lastMove = history[history.length - 1];
        return lastMove.row === row && lastMove.col === col;
    }

    const replayBoard = gameState === 'replay' ? Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)) : null;
    if (replayBoard) {
        for (let i = 0; i <= replayMoveIndex; i++) {
            if(history[i]) replayBoard[history[i].row][history[i].col] = history[i].player;
        }
    }

    const currentBoard = whatIfState ? whatIfState.board : (replayBoard || board);

    const aiProfile: Profile | null = gameMode === 'pva' ? { id: 'ai', username: 'Gomoku AI', elo_rating: 1500, is_supporter: true, nickname_color: null, badge_color: null } : null;

    let winnerName: string | null = null;
    if (winner) {
        if (gameMode === 'pvo') {
            winnerName = winner === playerRole ? userProfile?.username ?? null : opponentProfileRef.current?.username ?? null;
        } else if (gameMode === 'pva') {
            winnerName = winner === aiPlayer ? aiProfile?.username ?? null : userProfile?.username ?? null;
        } else { // pvp
            winnerName = winner.charAt(0).toUpperCase() + winner.slice(1);
        }
    }

    const p1Profile = gameMode === 'pvo' ? (playerRole === 'black' ? userProfile : opponentProfileRef.current) : (gameMode === 'pva' ? (aiPlayer === 'white' ? userProfile : aiProfile) :
        userProfile);
    const p2Profile = gameMode === 'pvo' ? (playerRole === 'white' ? userProfile : opponentProfileRef.current) : (gameMode === 'pva' ? (aiPlayer === 'black' ? userProfile : aiProfile) :
        opponentProfileRef.current);

    const isPva = gameMode === 'pva';
    const timerApplies = (gameMode === 'pvo' || gameMode === 'pva');

    return (
        <>
            {isPva && <PvaBackground />}
            <div className={`flex flex-col items-center w-full h-full relative p-6`}>
                <div className="absolute top-0 left-0">
                    <button onClick={onExit} className="text-gray-400 hover:text-gray-200 p-2 transition-colors btn-hover-scale">
                        {t('Back')}
                    </button>
                </div>

                {gameMode === 'pvo' && !room && !spectateRoomId && <OnlineMultiplayerMenu setGameMode={setGameMode} socketRef={socketRef} userProfile={userProfile} onlineUsers={onlineUsers} inQueueUsers={inQueueUsers} isSocketConnected={isSocketConnected} />}

                <div className="flex w-full max-w-4xl justify-around items-center mb-8 relative">
                    {activeEmoticon && p1Profile && activeEmoticon.fromId === p1Profile.id && (
                        <div key={activeEmoticon.id} className="absolute left-0 -top-16 text-5xl emoticon-final-animation z-10">
                            {activeEmoticon.emoticon}
                        </div>
                    )}
                    <PlayerDisplay profile={p1Profile} />
                    <span className="text-2xl font-bold text-white">VS</span>
                    <PlayerDisplay profile={p2Profile} />
                    {activeEmoticon && p2Profile && activeEmoticon.fromId === p2Profile.id && (
                        <div key={activeEmoticon.id} className="absolute right-0 -top-16 text-5xl emoticon-final-animation z-10">
                            {activeEmoticon.emoticon}
                        </div>
                    )}
                </div>

                {(gameMode !== 'pvo' || room) && (
                    <div className="relative" style={{ width: '64vmin', height: '64vmin' }}>
                        {/* The frame with a wooden color */}
                        <div className="p-4 bg-[#d2b48c] rounded-md shadow-lg w-full h-full">
                            {/* The interactive grid area */}
                            <div 
                                onClick={handleBoardClick} 
                                className={`goboard bg-[#c19a6b] relative w-full h-full rounded-sm ${isSpectator || (gameMode === 'pva' && currentPlayer === aiPlayer) || (gameState !== 'playing' && !whatIfState) ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                            >
                                {/* Lines are drawn on a transparent overlay inside the grid */}
                                <div className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{ padding: `calc(100% / (${BOARD_SIZE} - 1) / 2)` }}>
                                    {Array.from({length: BOARD_SIZE}).map((_, i) => <div key={`v-${i}`} className="goboard-line absolute" style={{left: `${(i / (BOARD_SIZE - 1)) * 100}%`, top: 0, width: '1px', height: '100%'}}></div>)}
                                    {Array.from({length: BOARD_SIZE}).map((_, i) => <div key={`h-${i}`} className="goboard-line absolute" style={{top: `${(i / (BOARD_SIZE - 1)) * 100}%`, left: 0, height: '1px', width: '100%'}}></div>)}
                                </div>
                                {/* Stones are drawn on another transparent overlay inside the grid */}
                                <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
                                    {currentBoard.map((row, r_idx) => row.map((cell, c_idx) => {
                                        if (cell) {
                                            const stoneSize = `calc(100% / ${BOARD_SIZE} * 0.9)`;
                                            const isWinStone = isWinningStone(r_idx, c_idx);
                                            const isLast = isLastMove(r_idx, c_idx);
                                            const stoneClasses = `absolute rounded-full stone-shadow ${isWinStone ? 'animate-chroma-shine' : ''} ${!isWinStone && isLast ? 'animate-slime-in' : ''}`;
                                            return <div key={`${r_idx}-${c_idx}`} className={stoneClasses} style={{
                                                top: `calc(${(r_idx / (BOARD_SIZE - 1)) * 100}% - (${stoneSize} / 2))`,
                                                left: `calc(${(c_idx / (BOARD_SIZE - 1)) * 100}% - (${stoneSize} / 2))`,
                                                width: stoneSize,
                                                height: stoneSize,
                                                backgroundColor: cell,
                                                border: '1px solid gray'
                                            }}></div>;
                                        }
                                        return null;
                                    }))}
                                    {/* Forbidden Move Markers */}
                                    {forbiddenMoves.map(({row, col}) => {
                                        const stoneSize = `calc(100% / ${BOARD_SIZE} * 0.9)`;
                                        return <div key={`f-${row}-${col}`} className="absolute rounded-full forbidden-move-marker" style={{
                                            top: `calc(${(row / (BOARD_SIZE - 1)) * 100}% - (${stoneSize} / 2))`,
                                            left: `calc(${(col / (BOARD_SIZE - 1)) * 100}% - (${stoneSize} / 2))`,
                                            width: stoneSize,
                                            height: stoneSize,
                                        }}></div>
                                    })}
                                </div>
                            </div>
                        </div>
                        {/* The overlay is now a sibling to the frame, and will cover the whole 64vmin area */}
                        {winner &&
                            <GameEndModal winnerName={winnerName} duration={gameDuration}>
                                <PostGameManager 
                                    isPlayer={!isSpectator} 
                                    isSpectator={isSpectator} 
                                    onExit={onExit} 
                                    gameMode={gameMode} 
                                    room={room} 
                                    socketRef={socketRef} 
                                    onRematch={() => resetGame(gameMode)} 
                                />
                            </GameEndModal>
                        }
                    </div>
                )}

                <div className="mt-4 flex flex-col items-center gap-2">
                    {timerApplies && gameState === 'playing' && (gameMode === 'pva' || room) && (
                        <div className="flex items-center gap-3 p-2 bg-gray-800/70 rounded-lg">
                            <div className={`w-6 h-6 rounded-full ${currentPlayer === 'black' ? 'bg-black' : 'bg-white'}`}></div>
                            <span className="text-2xl font-mono text-white">{formatTime(turnTimeRemaining)}</span>
                            {gameMode === 'pvo' && <RuleInfo />}
                        </div>
                    )}

                    {gameState === 'replay' && (
                        <ReplayControls
                            moveCount={history.length}
                            currentMove={replayMoveIndex}
                            setCurrentMove={setReplayMoveIndex}
                            isPlaying={isReplaying}
                            setIsPlaying={setIsReplaying}
                            onWhatIf={replayGame?.game_type === 'pva' ? handleWhatIf : undefined}
                        />
                    )}
                    {whatIfState && <button onClick={exitWhatIf} className="mt-2 px-4 py-2 bg-red-500 text-white rounded">{t('ExitWhatIf')}</button>}
                </div>

                {showRoomCodeModal && createdRoomId && (
                    <RoomCodeModal roomId={createdRoomId} onClose={() => setShowRoomCodeModal(false)} />
                )}
                {gameState === 'playing' && !isSpectator && (
                    <div className="fixed bottom-5 right-5 z-20">
                        <EmoticonPicker onSelect={handleSendEmoticon} />
                    </div>
                )}
            </div>
        </>
    );
}

export default Board;
