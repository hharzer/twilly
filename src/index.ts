import { Router, Response, RequestHandler } from 'express';

import { getSha256Hash } from './util';
import {
  TwilioController,
  TwilioControllerArgs,
  TwilioWebhookRequest,
} from './twllio';
import {
  ExitKeywordTest,
  Flow,
  FlowController,
  FlowSchema,
  OnInteractionEndHook,
  defaultTestForExit,
} from './Flows';
import {
  Message,
  Question,
  Reply,
} from './Actions';
import {
  InteractionContext,
  SmsCookie,
  updateContext,
} from './SmsCookie';

export {
  Flow,
  FlowSchema,
} from './Flows';
export {
  Message,
  Question,
  Reply,
  Trigger,
} from './Actions';

const cookieParser =
  <(secret: string) => RequestHandler>require('cookie-parser');


const DEFAULT_EXIT_TEXT = 'Goodbye.';
const DELAY = process.env.NODE_ENV === 'test' ? 10 : 1000;
const ROUTE_REGEXP = /^\/?$/i;


type OnMessageHook =
  (context?: InteractionContext, user?: any, messageBody?: string) => any;

type OnCatchErrorHook =
  (context?: InteractionContext, user?: any, err?: Error) => any;

type UserContextGetter = (from: string) => any;


async function handleIncomingSmsWebhook(
  getUserContext: UserContextGetter,
  onCatchError: OnCatchErrorHook,
  onMessage: OnMessageHook,
  fc: FlowController,
  tc: TwilioController,
  req: TwilioWebhookRequest,
  res: Response,
) {
  let state: SmsCookie = null;
  let userCtx: any = null;

  try {
    state = tc.getSmsCookieFromRequest(req);
    userCtx = await getUserContext(req.body.From); // will throw any errors not caught in promise

    let action = await fc.resolveActionFromState(req, state, userCtx);

    if (onMessage) {
      try {
        const result = await onMessage(
          state.interactionContext, userCtx, req.body.Body);
        if (result instanceof Message) {
          await tc.sendMessageNotification(result);
        }
      } catch (err) {
        onCatchError(state.interactionContext, userCtx, err);
      }
    }

    while (action !== null) {
      await tc.handleAction(req, action);
      await new Promise(
        resolve => setTimeout(resolve, DELAY)); // for preserving message order

      state = await fc.resolveNextStateFromAction(req, state, action);

      if (
        (state.isComplete)
        || (
          action instanceof Question
          && !(<Question>action).isComplete
        )
      ) break;
      action = await fc.resolveActionFromState(req, state, userCtx);
      if (action === null) break;
    }

    if (state.isComplete) {
      if (fc.onInteractionEnd !== null) {
        try {
          const result =
            await fc.onInteractionEnd(state.interactionContext, userCtx);
          if (result instanceof Message) {
            await tc.sendMessageNotification(result);
          }
        } catch (err) {
          onCatchError(state.interactionContext, userCtx, err);
        }
      }

      tc.clearSmsCookie(res);
    } else {
      tc.setSmsCookie(res, state);
    }

    tc.sendEmptyResponse(res);
  } catch (err) {
    const result = await onCatchError(
      state.interactionContext, userCtx, err);

    try {
      if (result instanceof Reply) {
        await tc.handleAction(req, result);
        state = updateContext(
          state,
          fc.getCurrentFlow(state),
          result,
        );
      }
      if (fc.onInteractionEnd !== null) {
        await fc.onInteractionEnd(state.interactionContext, userCtx);
      }
    } catch (innerErr) {
      await onCatchError(
        state.interactionContext, userCtx, innerErr);
    }

    tc.clearSmsCookie(res);
    tc.sendEmptyResponse(res);
  }
}

interface TwillyParameters extends TwilioControllerArgs {
  cookieSecret?: string;
  getUserContext?: UserContextGetter;
  onCatchError?: OnCatchErrorHook;
  onInteractionEnd?: OnInteractionEndHook;
  onMessage?: OnMessageHook;
  root: Flow,
  schema?: FlowSchema,
  testForExit?: ExitKeywordTest;
}

const defaultParameters = <TwillyParameters>{
  cookieKey: null,
  cookieSecret: null,
  getUserContext: <UserContextGetter>(() => null),
  onCatchError: <OnCatchErrorHook>(() => null),
  onInteractionEnd: null,
  onMessage: null,
  schema: null,
  sendOnExit: DEFAULT_EXIT_TEXT,
  testForExit: defaultTestForExit,
};

export function twilly({
  accountSid,
  authToken,
  messagingServiceSid,

  root,
  schema = defaultParameters.schema,

  cookieKey = defaultParameters.cookieKey,
  cookieSecret = defaultParameters.cookieSecret,

  getUserContext = defaultParameters.getUserContext,

  onCatchError = defaultParameters.onCatchError,
  onInteractionEnd = defaultParameters.onInteractionEnd,
  onMessage = defaultParameters.onMessage,

  sendOnExit = defaultParameters.sendOnExit,
  testForExit = defaultParameters.testForExit,
}: TwillyParameters): Router {
  if (!cookieKey) {
    cookieKey = getSha256Hash(accountSid, accountSid).slice(0, 16);
  }
  if (!cookieSecret) {
    cookieSecret = getSha256Hash(accountSid, authToken);
  }

  const fc = new FlowController(root, schema, {
    onInteractionEnd,
    testForExit,
  });
  const tc = new TwilioController({
    accountSid,
    authToken,
    cookieKey,
    messagingServiceSid,
    sendOnExit,
  });
  const router = Router();

  router.use(cookieParser(cookieSecret));
  router.post(
    ROUTE_REGEXP,
    handleIncomingSmsWebhook.bind(
      null, getUserContext, onCatchError, onMessage, fc, tc));
  return router;
}
