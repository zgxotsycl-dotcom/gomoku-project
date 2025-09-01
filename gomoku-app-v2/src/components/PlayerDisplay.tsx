'use client';

import type { Profile } from '../types';

interface PlayerDisplayProps { 
    profile: Profile | null; 
}

const PlayerDisplay = ({ profile }: PlayerDisplayProps) => {
    if (!profile) return <div className="w-48 h-16 bg-gray-700 rounded-lg animate-pulse" />;

    return (
        <div className="relative w-48 p-3 bg-gray-700 rounded-lg text-white text-center">
            <p className="font-bold truncate" style={{ color: profile.is_supporter ? profile.nickname_color || '#FFFFFF' : '#FFFFFF' }}>{profile.username}</p>
            <p className="text-sm text-cyan-400">{profile.elo_rating} ELO</p>
        </div>
    );
};

export default PlayerDisplay;
