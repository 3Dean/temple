import { defineFunction } from '@aws-amplify/backend';

export const tts = defineFunction({
  name: 'tts',
  entry: './handler.ts',
  timeoutSeconds: 20,
  memoryMB: 512,
  environment: {
    VOICE_ID: 'Joanna',
  },
});
