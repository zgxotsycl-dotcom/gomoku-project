'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import type { Socket } from 'socket.io-client';
import type { GameMode, Profile } from '../types';

interface OnlineMultiplayerMenuProps { 
    setGameMode: (mode: GameMode) => void; 
    socketRef: React.MutableRefObject<Socket | null>; 
    userProfile: Profile | null; 
    onlineUsers: number;
    inQueueUsers: number;
    isSocketConnected: boolean;
}

const OnlineMultiplayerMenu = ({ setGameMode, socketRef, userProfile, onlineUsers, inQueueUsers, isSocketConnected }: OnlineMultiplayerMenuProps) => {
    const { t } = useTranslation();
    const [mode, setMode] = useState<'select' | 'private'>('select');
    const [roomInput, setRoomInput] = useState('');
    const [isQueuing, setIsQueuing] = useState(false);

    const handlePublicMatch = () => { 
        socketRef.current?.emit('join-public-queue', userProfile);
        toast.success(t('SearchingForPublicMatch', 'Searching for a match...'));
        setIsQueuing(true);
    };
    const handleCancelMatchmaking = () => {
        socketRef.current?.emit('leave-public-queue');
        toast.error(t('MatchmakingCancelled', 'Matchmaking cancelled.'));
        setIsQueuing(false);
    };
    const handleCreatePrivate = () => { socketRef.current?.emit('create-private-room', userProfile); };
    const handleJoinPrivate = () => { if (roomInput) socketRef.current?.emit('join-private-room', roomInput, userProfile); };

    const buttonsDisabled = !isSocketConnected || isQueuing;

    if (mode === 'private') {
        return (
            <div className="flex flex-col gap-2 mb-4 p-4 bg-gray-600 rounded-lg">
                <div className="flex gap-2">
                    <input type="text" value={roomInput} onChange={(e) => setRoomInput(e.target.value)} placeholder={t('EnterRoomCode')} className="px-2 py-1 rounded text-black" />
                    <button onClick={handleJoinPrivate} className="px-4 py-1 bg-yellow-500 text-black rounded btn-hover-scale" disabled={!isSocketConnected}>{t('Join')}</button>
                </div>
                <button onClick={() => setMode('select')} className="text-sm text-gray-300 hover:underline btn-hover-scale">{t('Back')}</button>
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-4 mb-4 p-4 bg-gray-600 rounded-lg">
            <div className="flex justify-between text-white text-sm mb-2 gap-4">
                <span>{t('Online')}: {onlineUsers}</span>
                <span>{t('InQueue')}: {inQueueUsers}</span>
            </div>
            <button onClick={handlePublicMatch} className="px-4 py-2 bg-indigo-500 text-white rounded btn-hover-scale" disabled={buttonsDisabled}>{t('StartPublicMatch')}</button>
            <button onClick={handleCreatePrivate} className="px-4 py-2 bg-teal-500 text-white rounded btn-hover-scale" disabled={buttonsDisabled}>{t('CreatePrivateRoom')}</button>
            <button onClick={() => setMode('private')} className="px-4 py-2 bg-gray-500 text-white rounded btn-hover-scale" disabled={buttonsDisabled}>{t('JoinPrivateRoom')}</button>
            
            <div className="h-6 mt-2">
                {isQueuing && (
                    <button onClick={handleCancelMatchmaking} className="text-sm text-red-400 hover:underline btn-hover-scale w-full">
                        {t('CancelMatchmaking', 'Cancel Matchmaking')}
                    </button>
                )}
            </div>
        </div>
    );
};

export default OnlineMultiplayerMenu;