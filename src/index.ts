import { Router, Response } from 'express';

import {
  OnCatchErrorHook,
  getSha256Hash,
  createHandleError,
} from './util';
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
  InteractionEndHook,
} from './Flows';
import {
  Message,
  Question,
  Reply,
} from './Actions';
import {
  InteractionContext,
  SmsCookie,
} from './SmsCookie';

export {
  Flow,
  FlowSchema,
} from './Flows';
export {
  Message,
  Question,
  Trigger,
  Reply,
} from './Actions';

const cookieParser = require('cookie-parser');


const DEFAULT_EXIT_TEXT = 'Goodbye.';


type OnMessageHook =
  (context: InteractionContext, user: any, messageBody: string) => any;
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
  let state = <SmsCookie>{ interactionContext: [], flowContext: {} };
  let userCtx = null;
  let handleError = createHandleError(null, null, onCatchError);

  try {
    state = tc.getSmsCookeFromRequest(req);
    userCtx = await getUserContext(req.body.From); // will throw any errors not caught in promise
    handleError = createHandleError(state.interactionContext, userCtx, onCatchError);

    let action =
      await fc.resolveActionFromState(
        req, state, userCtx, handleError);

    if (onMessage) {
      try {
        const result = await onMessage(
          state.interactionContext, userCtx, req.body.Body);
        if (result instanceof Message) {
          await tc.sendOnMessageNotification(result, handleError);
        }
      } catch (err) {
        onCatchError(state.interactionContext, userCtx, err);
      }
    }

    while (action !== null) {
      await tc.handleAction(req, action, handleError);
      await new Promise(
        resolve => setTimeout(resolve, 1000)); // for preserving message order

      state =
        await fc.resolveNextStateFromAction(req, state, action);

      if (
        (state.isComplete)
        || (
          action instanceof Question
          && !(<Question>action).isComplete
        )
      ) break;
      action =
        await fc.resolveActionFromState(
          req, state, userCtx, handleError);
      if (action === null) break;
    }

    if (state.isComplete) {
      fc.onInteractionEnd(state.interactionContext, userCtx);
      tc.clearSmsCookie(res);
    } else {
      tc.setSmsCookie(res, state);
    }

    tc.sendEmptyResponse(res);
  } catch (err) {
    const result =
      await onCatchError(
        state.interactionContext, userCtx, err); // will also throw any uncaught errors
    if (result instanceof Reply) {
      await tc.sendSmsResponse(res, result.body);
      return;
    }
    tc.clearSmsCookie(res);
    tc.sendEmptyResponse(res);
  }
}

interface TwillyParameters extends TwilioControllerArgs {
  cookieSecret?: string;
  getUserContext?: UserContextGetter;
  onCatchError?: OnCatchErrorHook;
  onInteractionEnd?: InteractionEndHook;
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
  testForExit: null,
};

export function twilly({
  accountSid,
  authToken,
  messageServiceId,

  cookieKey = defaultParameters.cookieKey,
  cookieSecret = defaultParameters.cookieSecret,

  getUserContext = defaultParameters.getUserContext,

  onCatchError = defaultParameters.onCatchError,
  onInteractionEnd = defaultParameters.onInteractionEnd,
  onMessage = defaultParameters.onMessage,

  root,
  schema = defaultParameters.schema,

  sendOnExit = defaultParameters.sendOnExit,
  testForExit = defaultParameters.testForExit,
}: TwillyParameters): Router {
  if (!cookieKey) {
    cookieKey = getSha256Hash(accountSid, accountSid).slice(0, 10);
  }
  if (!cookieSecret) {
    cookieSecret = getSha256Hash(accountSid, authToken);
  }

  const fc = new FlowController(root, schema, {
    testForExit,
    onInteractionEnd,
  });
  const tc = TwilioController.create({
    accountSid,
    authToken,
    cookieKey,
    messageServiceId,
    sendOnExit,
  });
  const router = Router();

  router.use(cookieParser(cookieSecret));
  router.post(
    '/',
    handleIncomingSmsWebhook.bind(
      null, getUserContext, onCatchError, onMessage, fc, tc));
  return router;
}
