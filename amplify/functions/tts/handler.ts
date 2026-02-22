import {
  PollyClient,
  SynthesizeSpeechCommand,
  type VoiceId,
} from '@aws-sdk/client-polly';

const MAX_TEXT_LENGTH = 1200;
const DEFAULT_VOICE_ID = 'Joanna';
const SUPPORTED_TEXT_TYPES = new Set(['text', 'ssml']);

const polly = new PollyClient({});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
};

const response = (
  statusCode: number,
  body: string,
  contentType = 'application/json'
) => ({
  statusCode,
  headers: {
    ...corsHeaders,
    'Content-Type': contentType,
  },
  body,
});

const toUint8Array = async (audioStream: unknown): Promise<Uint8Array> => {
  if (!audioStream) return new Uint8Array();

  const maybeTransform = audioStream as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof maybeTransform.transformToByteArray === 'function') {
    return maybeTransform.transformToByteArray();
  }

  if (audioStream instanceof Uint8Array) {
    return audioStream;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of audioStream as AsyncIterable<Uint8Array | Buffer | string>) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }

  return Buffer.concat(chunks);
};

export const handler = async (
  event: any
) => {
  if (event.requestContext.http.method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  if (event.requestContext.http.method !== 'POST') {
    return response(405, JSON.stringify({ error: 'Method Not Allowed' }));
  }

  try {
    const parsedBody = event.body ? JSON.parse(event.body) : {};
    const text = typeof parsedBody?.text === 'string' ? parsedBody.text.trim() : '';
    const requestedType =
      typeof parsedBody?.type === 'string' ? parsedBody.type.trim().toLowerCase() : 'text';
    const textType = SUPPORTED_TEXT_TYPES.has(requestedType) ? requestedType : 'text';

    if (!text) {
      return response(400, JSON.stringify({ error: 'text is required' }));
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return response(
        400,
        JSON.stringify({
          error: `text exceeds max length of ${MAX_TEXT_LENGTH} characters`,
        })
      );
    }

    const voiceId = (process.env.VOICE_ID || DEFAULT_VOICE_ID) as VoiceId;
    console.log('Synthesizing speech', {
      textLength: text.length,
      textType,
      voiceId,
    });

    const synth = await polly.send(
      new SynthesizeSpeechCommand({
        Text: text,
        TextType: textType,
        OutputFormat: 'mp3',
        VoiceId: voiceId,
        Engine: 'neural',
      })
    );

    const mp3Bytes = await toUint8Array(synth.AudioStream);
    if (!mp3Bytes.length) {
      console.error('Polly response did not contain audio bytes');
      return response(502, JSON.stringify({ error: 'No audio returned from Polly' }));
    }

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
      body: Buffer.from(mp3Bytes).toString('base64'),
    };
  } catch (error) {
    console.error('TTS synthesis failed', error);
    return response(500, JSON.stringify({ error: 'Failed to synthesize speech' }));
  }
};
