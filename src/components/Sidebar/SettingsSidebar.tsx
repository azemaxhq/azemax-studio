import React from 'react';
import { SettingsPanel } from '../Settings/SettingsPanel';

export const SettingsSidebar: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  return <SettingsPanel onClose={onClose} />;
};