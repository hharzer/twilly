import Trigger from './Trigger';
import { GetContext } from './Action';
import { uniqueString } from '../util';


test('Trigger should set constructor argument as flowName property', () => {
  const flowName = uniqueString();
  const t = new Trigger(flowName);

  expect(t.flowName).toBe(flowName);
});


test(
  'Trigger should throw a TypeError if the '
    + 'constructor argument is not a non-empty string',
  () => {
    let caught: Error;
    const executeTest = (flowName: any) => {
      try {
        new Trigger(flowName);
      } catch (err) {
        caught = err;
      }
      expect(caught instanceof TypeError).toBeTruthy();
      expect(caught.message).toBe(
        'Trigger constructor expects a non-empty string as its constructor argument');
    }

    executeTest(1);
    executeTest('');
    executeTest({});
    executeTest([]);
    executeTest(false);
    executeTest(() => {});
  },
);


test('Trigger should contain flowName in the context', () => {
  const flowName = uniqueString();
  const t = new Trigger(flowName);

  expect(t[GetContext]()).toEqual({ flowName });
});