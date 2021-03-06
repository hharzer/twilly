import {
  EvaluatedSchema,
  Flow,
  FlowSchema,
  FlowSelectActionResolver,
  FlowSelectActionName,
  evaluateSchema,
} from '.';
import {
  Action,
  ActionSetName,
  Exit,
  Question,
  QuestionShouldContinueOnFail,
  Trigger,
  QuestionEvaluate,
} from '../Actions';
import {
  InteractionContext,
  SmsCookie,
  completeInteraction,
  handleTrigger,
  incrementFlowAction,
  startQuestion,
  updateContext,
  addQuestionAttempt,
  createSmsCookie,
  FlowContext,
} from '../SmsCookie';
import {
  TwilioWebhookRequest,
  getMockTwilioWebhookRequest,
} from '../twllio';
import { compose, deepCopy } from '../util';


type SmsCookieUpdate = (state?: SmsCookie) => SmsCookie;

export function pipeSmsCookieUpdates(...funcs: SmsCookieUpdate[]): SmsCookieUpdate {
  return (
    cookie: SmsCookie = createSmsCookie(getMockTwilioWebhookRequest()),
  ): SmsCookie => compose(...funcs)(cookie);
}


export type ExitKeywordTest =
  (body: string) => (boolean | Promise<boolean>);

export type OnInteractionEndHook =
  (context: InteractionContext, userCtx: any) => any;


const EXIT_REGEXP = /(\b)(exit)(\b)/i;

export const defaultTestForExit =
  <ExitKeywordTest>((body: string) => EXIT_REGEXP.test(body))


export interface FlowControllerOptions {
  onInteractionEnd?: OnInteractionEndHook;
  testForExit?: ExitKeywordTest;
}

const defaultOptions = <FlowControllerOptions>{
  onInteractionEnd: () => null,
  testForExit: defaultTestForExit,
};


export default class FlowController {
  private readonly root: Flow;
  private readonly schema: EvaluatedSchema;
  private testForExit: ExitKeywordTest;

  public readonly onInteractionEnd: OnInteractionEndHook;

  constructor(
    root: Flow,
    schema?: FlowSchema,
    {
      onInteractionEnd = defaultOptions.onInteractionEnd,
      testForExit = defaultOptions.testForExit,
    }: FlowControllerOptions = defaultOptions,
  ) {
    if (!(root instanceof Flow)) {
      throw new TypeError(
        'root parameter must be an instance of Flow');
    }
    if (root.length === 0) {
      throw new TypeError(
        'All Flows must perform at least one action. Check the root Flow');
    }
    if (schema && !(schema instanceof FlowSchema)) {
      throw new TypeError(
        'schema parameter must be an instance of FlowSchema');
    }
    if (typeof testForExit !== 'function') {
      throw new TypeError(
        'testForExit parameter must be a function');
    }
    // other type checking here
    this.root = root;
    if (schema) {
      // DFS of schema to get each user-defined flow
      // uniqueness of flow names is enforced by the fact that JS objects cannot have duplicate keys
      // each Flow instance can only be used once in the schema
      this.schema = evaluateSchema(root, schema);
      if (this.schema.size === 1) {
        throw new TypeError(
          'If you provide the schema parameter, it must include a flow distinct from the root Flow');
      }
    }
    this.onInteractionEnd = onInteractionEnd;
    this.testForExit = testForExit;
  }

  public getCurrentFlow(state: SmsCookie): Flow {
    if (
      (!state.flow) ||
      (state.flow === this.root.name)
    ) {
      return this.root;
    }
    if (!(this.schema && this.schema.has(state.flow))) {
      throw new TypeError(
        `Received invalid flow name in SMS cookie: ${state.flow}`);
    }
    return this.schema.get(state.flow);
  }

  public async resolveActionFromState(
    req: TwilioWebhookRequest,
    state: SmsCookie,
    userCtx: any,
  ): Promise<Action> {
    if (state.isComplete) {
      return null;
    }
    if (this.testForExit && await this.testForExit(req.body.Body)) {
      return new Exit(req.body.Body);
    }

    const key = Number(state.flowKey);
    const currFlow = this.getCurrentFlow(state);
    const resolveAction = currFlow[FlowSelectActionResolver](key);

    if (!resolveAction) {
      return null;
    }

    const action = await resolveAction(deepCopy<FlowContext>(state.flowContext), userCtx);
    if (action instanceof Question) {
      await action[QuestionEvaluate](req, state);
    }
    if (!(action instanceof Action)) {
      return null;
    }
    action[ActionSetName](currFlow[FlowSelectActionName](key));

    return action;
  }

  public resolveNextStateFromAction(
    req: TwilioWebhookRequest,
    state: SmsCookie,
    action: Action,
  ): SmsCookie {
    const currFlow = this.getCurrentFlow(state);

    if (!(action instanceof Action)) {
      return completeInteraction(state);
    }
    if (action instanceof Exit) {
      return pipeSmsCookieUpdates(
        (s: SmsCookie) => updateContext(s, currFlow, action),
        completeInteraction,
      )(state);
    }

    switch (action.constructor) {
      case Question:
        return ((): SmsCookie => {
          const question = <Question>action;

          if (state.question.isAnswering) {
            state = addQuestionAttempt(state, req.body.Body);
          }
          if (question.isAnswered) {
            return pipeSmsCookieUpdates(
              (s: SmsCookie) => updateContext(s, currFlow, action),
              (s: SmsCookie) => incrementFlowAction(s, currFlow),
            )(state);
          }
          if (question.isFailed) {
            if (question[QuestionShouldContinueOnFail]) {
              return pipeSmsCookieUpdates(
                (s: SmsCookie) => updateContext(s, currFlow, action),
                (s: SmsCookie) => incrementFlowAction(s, currFlow),
              )(state);
            }
            return pipeSmsCookieUpdates(
              (s: SmsCookie) => updateContext(s, currFlow, action),
              completeInteraction,
            )(state);
          }
          if (state.question.isAnswering) {
            return updateContext(state, currFlow, action);
          }

          return pipeSmsCookieUpdates(
            startQuestion,
            (s: SmsCookie) => updateContext(s, currFlow, action),
          )(state);
        })();

      case Trigger:
        return ((): SmsCookie => {
          const trigger = <Trigger>action;

          if ((currFlow === this.root) && (!this.schema)) {
            throw new Error(
              'Cannot use Trigger action without a defined Flow schema');
          }
          if (
            !(trigger.flowName === this.root.name
              || this.schema.has(trigger.flowName))
          ) {
            throw new Error(
              'Trigger constructors expect a name of an existing Flow');
          }

          return pipeSmsCookieUpdates(
            (s: SmsCookie) => updateContext(s, currFlow, action),
            (s: SmsCookie) => handleTrigger(s, trigger),
          )(state);
        })();

      default:
        return pipeSmsCookieUpdates(
          (s: SmsCookie) => updateContext(s, currFlow, action),
          (s: SmsCookie) => incrementFlowAction(s, currFlow),
        )(state);
    }
  }
}
