import { ActionContext } from '../Actions';

export { default as createSmsCookie } from './create';


export interface SmsCookie {
  from: string;
  interactionId: string;
  currFlow: string;
  currFlowAction: string | number;
  flowContext: { [index: string]: ActionContext }; // TODO make type for this
}
