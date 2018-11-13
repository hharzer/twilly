import FlowController from './Controller';
import Flow from './Flow';
import FlowSchema from './FlowSchema';
import { Reply } from '../Actions';
import { uniqueString } from '../util';
import { getMockTwilioWebhookRequest } from '../twllio';
import { createSmsCookie } from '../SmsCookie';


const randomFlow = () =>
  new Flow(uniqueString()).addAction(
    uniqueString(), () => new Reply(uniqueString()));


test('FlowController base case: root flow with one action', () => {
  let caught: Error;
  try {
    new FlowController(
      new Flow(uniqueString()).addAction(
        uniqueString(),
        () => new Reply(uniqueString())));
  } catch (err) {
    caught = err;
  }
  expect(caught).toBe(undefined);
});


test(
  'FlowController constructor should throw a TypeError '
    + 'if the first argument is not a Flow',
  () => {
    const executeTest = (root: any) => {
      let caught: Error;
      try {
        new FlowController(root);
      } catch (err) {
        caught = err;
      }
      expect(caught instanceof TypeError).toBeTruthy();
      expect(caught.message).toBe(
        'root parameter must be an instance of Flow');
    };

    executeTest('');
    executeTest(1);
    executeTest(null);
    executeTest(undefined);
    executeTest({});
    executeTest(() => {});
    executeTest([]);
    executeTest(new FlowSchema({}));
  },
);


test(
  'FlowController constructor should throw a TypeError '
    + 'if the root flow has no actions',
  () => {
    let caught: Error;
    try {
      new FlowController(
        new Flow(uniqueString()));
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof TypeError).toBeTruthy();
    expect(caught.message).toBe(
      'All Flows must perform at least one action. Check the root Flow');
  },
);


test('FlowController schema parameter: base case', () => {
  let caught: Error;
  try {
    new FlowController(
      new Flow(uniqueString()).addAction(
        uniqueString(),
        () => new Reply(uniqueString())),
      new FlowSchema({
        [uniqueString()]: new Flow(uniqueString()).addAction(
          uniqueString(),
          () => new Reply(uniqueString()))
      }),
    );
  } catch (err) {
    caught = err;
  }
  expect(caught).toBe(undefined);
});


test(
  'FlowController constructor should throw a TypeError '
    + 'if schema is not a FlowSchema instance',
  () => {
    const executeTest = (schema: any) => {
      let caught: Error;
      try {
        new FlowController(
          new Flow(uniqueString()).addAction(
            uniqueString(),
            () => new Reply(uniqueString())),
          schema,
        );
      } catch (err) {
        caught = err;
      }
      expect(caught instanceof TypeError).toBeTruthy();
      expect(caught.message).toBe(
        'schema parameter must be an instance of FlowSchema');
    };

    executeTest('abc');
    executeTest(1);
    executeTest({});
    executeTest(() => { });
    executeTest([]);
    executeTest(new Flow(uniqueString()));
  },
);


test(
  'FlowController constructor should throw a TypeError '
    + 'if the schema does not define any Flows distinct from the root',
  () => {
    const root = new Flow(uniqueString()).addAction(
      uniqueString(),
      () => new Reply(uniqueString()));
    let caught: Error;
    try {
      new FlowController(root, new FlowSchema({
        [uniqueString()]: root,
        [uniqueString()]: new FlowSchema({
          [uniqueString()]: root,
        }),
      }));
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof TypeError).toBeTruthy();
    expect(caught.message).toBe(
      'If you provide the schema parameter, it must include a flow distinct from the root Flow');
  }
);


test(
  'FlowController resolveActionFromState should return null if interaction is complete',
  async () => {
    const fc = new FlowController(randomFlow());
    const req = getMockTwilioWebhookRequest();
    const user = {};
    const state = createSmsCookie(req);

    state.isComplete = true;
    const result = await fc.resolveActionFromState(req, state, user, () => {});

    expect(result).toBe(null);
  },
);


test(
  'FlowController resolveActionFromState should test if the user wants to exit the interaction',
  async () => {
    const testForExit = jest.fn();
    const fc = new FlowController(randomFlow(), null, {
      testForExit,
    });
    const req = getMockTwilioWebhookRequest({ body: uniqueString() });
    const user = {};
    const state = createSmsCookie(req);

    testForExit.mockResolvedValue(false);
    await fc.resolveActionFromState(req, state, user, () => { });

    expect(testForExit).toBeCalledTimes(1);
    expect(testForExit).toBeCalledWith(req.body.Body);
  },
);


test(
  'FlowController resolveActionFromState should default to the first action '
    + 'of the root if no Flow has been started',
  async () => {
    const replyName = uniqueString();
    const rootReply = new Reply(replyName);
    const resolver = jest.fn();
    const fc = new FlowController(
      new Flow(uniqueString()).addAction(replyName, resolver));
    const req = getMockTwilioWebhookRequest();
    const user = {};
    const state = createSmsCookie(req);

    resolver.mockResolvedValue(rootReply);
    const result = await fc.resolveActionFromState(req, state, user, () => {});

    expect(resolver).toBeCalledTimes(1);
    expect(resolver).toBeCalledWith(state.flowContext, user);
    expect(result instanceof Reply).toBeTruthy();
    expect(result.name).toBe(replyName);
  },
);


test(
  'FlowController resolveActionFromState should resolve an action in the root flow '
  + 'if the current flow in the SMS cookie is the root',
  async () => {
    const replyName = uniqueString()
    const rootReply = new Reply(replyName);
    const resolver = jest.fn();
    const root = new Flow(uniqueString()).addAction(replyName, resolver);
    const fc = new FlowController(root);
    const req = getMockTwilioWebhookRequest();
    const user = {};
    const state = createSmsCookie(req);

    state.flow = root.name;
    resolver.mockResolvedValue(rootReply);
    const result = await fc.resolveActionFromState(req, state, user, () => {});

    expect(resolver).toBeCalledTimes(1);
    expect(resolver).toBeCalledWith(state.flowContext, user);
    expect(result).toBe(rootReply);
    expect(result.name).toBe(replyName);
  },
);


test(
  'FlowController resolveActionFromState should resolve the current flow from the schema',
  async () => {
    const replyName = uniqueString();
    const flowReply = new Reply(replyName);
    const flowName = uniqueString();
    const resolver = jest.fn();
    const root = randomFlow();
    const schema = new FlowSchema({
      [uniqueString()]: randomFlow(),
      [uniqueString()]: new FlowSchema({
        [uniqueString()]: new Flow(flowName).addAction(replyName, resolver),
      }),
    });
    const fc = new FlowController(root, schema);
    const req = getMockTwilioWebhookRequest();
    const user = {};
    const state = createSmsCookie(req);

    state.flow = flowName;
    resolver.mockResolvedValue(flowReply);
    const result = await fc.resolveActionFromState(req, state, user, () => {});

    expect(resolver).toBeCalledTimes(1);
    expect(resolver).toBeCalledWith(state.flowContext, user);
    expect(result).toBe(flowReply);
    expect(result.name).toBe(replyName);
  },
);


// test resolveActionFromState
// test error handling
// test testForExit option with type checking
// test resolveNextStateFromAction
// test onInteractionEnd with type checking