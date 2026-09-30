import preset from '@youandfriends/config/vitest/react';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(preset, defineConfig({}));
