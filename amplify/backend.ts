import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { tts } from './functions/tts/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { HttpApi, CorsHttpMethod, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  tts,
});

backend.tts.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['polly:SynthesizeSpeech'],
    resources: ['*'],
  })
);

const apiStack = backend.createStack('tts-api');
const httpApi = new HttpApi(apiStack, 'TtsHttpApi', {
  corsPreflight: {
    allowOrigins: ['*'],
    allowMethods: [CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
    allowHeaders: ['content-type'],
  },
});

httpApi.addRoutes({
  path: '/api/tts',
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    'TtsLambdaIntegration',
    backend.tts.resources.lambda
  ),
});

backend.addOutput({
  custom: {
    ttsApiBaseUrl: httpApi.url,
  },
});
