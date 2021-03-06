import { uniqueString, compose } from '../util';
import {
  Action,
  ActionContext,
  Question,
  QuestionContext,
  Trigger,
  ActionGetContext,
} from '../Actions';
import { Flow, FlowActionNames } from '../Flows';
import {
  TwilioWebhookRequest,
} from '../twllio';


export type FlowContext = { [index: string]: ActionContext };
export type InteractionContext = ActionContext[];

export interface SmsCookie {
  createdAt: Date;
  from: string;
  flow: string;
  flowContext: FlowContext;
  flowKey: string | number;
  interactionContext: InteractionContext;
  interactionComplete: boolean;
  interactionId: string;
  isComplete: boolean;
  question: {
    attempts: string[];
    isAnswering: boolean;
  };
}


export function addQuestionAttempt(state: SmsCookie, attempt: string): SmsCookie {
  return {
    ...state,
    question: {
      ...state.question,
      attempts: [...state.question.attempts, attempt],
    },
  };
}


export function completeInteraction(state: SmsCookie) {
  return { ...state, isComplete: true };
}


export function createSmsCookie(req: TwilioWebhookRequest): SmsCookie {
  return {
    createdAt: new Date(),
    flow: null,
    flowContext: {},
    flowKey: 0,
    from: req.body.From,
    interactionComplete: false,
    interactionContext: [],
    interactionId: uniqueString(),
    isComplete: false,
    question: {
      attempts: [],
      isAnswering: false,
    },
  };
}


export function handleTrigger(state: SmsCookie, trigger: Trigger): SmsCookie {
  return {
    ...state,
    flow: trigger.flowName,
    flowKey: 0,
    flowContext: {},
  };
}


export function incrementFlowAction(
  state: SmsCookie,
  flow: Flow,
): SmsCookie {
  const newState = { ...state };
  newState.flowKey = Number(state.flowKey) + 1;
  if (newState.flowKey === flow.length) {
    return completeInteraction(state);
  }
  return newState;
}


export function startQuestion(state: SmsCookie): SmsCookie {
  return {
    ...state,
    question: {
      attempts: [],
      isAnswering: true,
    },
  };
}


function recordQuestionMessageSid(
  state: SmsCookie,
  question: Question,
): string[] {
  const prevSids =
    (<string[]>(state.flowContext[question.name] || {}).messageSid || []);
  return [
    ...prevSids,
    ...(<string[]>question.sid || []),
  ];
}

function getActionContext(state, flow, action): ActionContext {
  return (action instanceof Question ?
    <QuestionContext>{
      ...action[ActionGetContext](),
      messageSid: recordQuestionMessageSid(state, action),
    } : action[ActionGetContext]());
}

export function updateContext(
  state: SmsCookie,
  flow: Flow,
  action: Action,
): SmsCookie {
  if (!state) return null;
  if (!flow[FlowActionNames].has(action.name)) {
    throw new Error(
      `Flow ${flow.name} does not have an action named ${action.name}`);
  }
  if (!state.flow) state.flow = flow.name;
  return {
    ...state,
    flowContext: {
      ...state.flowContext,
      [action.name]: getActionContext(state, flow, action),
    },
    interactionContext: [
      ...state.interactionContext,
      {
        ...getActionContext(state, flow, action),
        flowName: flow.name,
      },
    ],
  };
}
