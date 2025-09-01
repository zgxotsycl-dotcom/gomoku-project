'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { FaPaintBrush, FaStar, FaUser, FaLock } from 'react-icons/fa';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
  const { t } = useTranslation();
  const { user, profile, updateProfile } = useAuth();
  const [username, setUsername] = useState('');
  const [nicknameColor, setNicknameColor] = useState('#FFFFFF');
  const [badgeColor, setBadgeColor] = useState('#FFD700');
  const [loading, setLoading] = useState(false);
  const [usernameError, setUsernameError] = useState('');

  const validateUsername = (name: string) => {
    if (name.length < 3) {
      setUsernameError(t('Nickname must be at least 3 characters long.'));
      return false;
    }
    if (name.length > 20) {
      setUsernameError(t('Nickname must be at most 20 characters long.'));
      return false;
    }
    setUsernameError('');
    return true;
  };

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUsername = e.target.value;
    setUsername(newUsername);
    validateUsername(newUsername);
  };

  useEffect(() => {
    if (!user || !isOpen) return;
    if (profile) {
      const currentUsername = profile.username || '';
      setUsername(currentUsername);
      validateUsername(currentUsername);
      setNicknameColor(profile.nickname_color || '#FFFFFF');
      setBadgeColor(profile.badge_color || '#FFD700');
    } else {
      const fetchProfile = async () => {
        const { data, error } = await supabase
          .from('profiles')
          .select('username, nickname_color, badge_color, is_supporter')
          .eq('id', user.id)
          .single();
        
        if (data) {
          const currentUsername = data.username || '';
          setUsername(currentUsername);
          validateUsername(currentUsername);
          setNicknameColor(data.nickname_color || '#FFFFFF');
          setBadgeColor(data.badge_color || '#FFD700');
        }
      };
      fetchProfile();
    }
  }, [user, isOpen, profile]);

  const handleSave = async () => {
    if (!user) return;

    if (!validateUsername(username)) {
      toast.error(t('Please fix the errors before saving.'));
      return;
    }

    setLoading(true);
    
    const updateData: {
        username: string;
        nickname_color?: string;
        badge_color?: string;
    } = {
        username: username,
    };

    if (profile?.is_supporter) {
        updateData.nickname_color = nicknameColor;
        updateData.badge_color = badgeColor;
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', user.id)
      .select()
      .single();

    setLoading(false);

    console.log('Supabase update response:', { data, error });

    if (error) {
      toast.error(t('FailedToSaveSettings') + ': ' + error.message);
    } else if (data) {
      toast.success(t('SettingsSaved'));
      updateProfile(data);
      onClose();
    } else {
      toast.error(t('FailedToSaveSettings') + ': ' + 'Profile not found after update.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-sm border border-gray-700">
        <h2 className="text-2xl font-bold text-white mb-4">{t('Settings')}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
              <FaUser /> {t('Nickname')}
            </label>
            <input 
              type="text" 
              value={username} 
              onChange={handleUsernameChange} 
              className={`w-full px-3 py-2 rounded bg-gray-700 text-white border ${usernameError ? 'border-red-500' : 'border-gray-600'} focus:ring-blue-500 focus:border-blue-500`}
              placeholder="Enter your nickname"
            />
            {usernameError && <p className="text-red-500 text-xs mt-1">{usernameError}</p>}
          </div>
          
          <div className={!profile?.is_supporter ? 'locked-feature' : ''}>
            <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
              <FaPaintBrush /> {t('NicknameColor')}
              {!profile?.is_supporter && <FaLock className="lock-icon" />}
            </label>
            <div className="flex items-center gap-2">
              <input type="color" value={nicknameColor} onChange={(e) => setNicknameColor(e.target.value)} className="w-10 h-10 rounded border-gray-600" disabled={!profile?.is_supporter}/>
              <input type="text" value={nicknameColor} onChange={(e) => setNicknameColor(e.target.value)} className="w-full px-2 py-1 rounded bg-gray-700 text-white border border-gray-600" disabled={!profile?.is_supporter}/>
            </div>
          </div>

          <div className={!profile?.is_supporter ? 'locked-feature' : ''}>
            <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
              <FaStar /> {t('PatronBadgeColor')}
              {!profile?.is_supporter && <FaLock className="lock-icon" />}
            </label>
            <div className="flex items-center gap-2">
                <input type="color" value={badgeColor} onChange={(e) => setBadgeColor(e.target.value)} className="w-10 h-10 rounded border-gray-600" disabled={!profile?.is_supporter}/>
                <input type="text" value={badgeColor} onChange={(e) => setBadgeColor(e.target.value)} className="w-full px-2 py-1 rounded bg-gray-700 text-white border border-gray-600" disabled={!profile?.is_supporter}/>
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-4">
          <button onClick={onClose} className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-500 btn-hover-scale">{t('Cancel')}</button>
          <button onClick={handleSave} disabled={loading || !!usernameError} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:bg-gray-400 btn-hover-scale">
            {loading ? t('Saving') : t('Save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;