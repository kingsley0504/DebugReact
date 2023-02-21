/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

let React;
let ReactNoop;
let Scheduler;
let act;

let getCacheForType;
let useState;
let Suspense;
let Offscreen;
let startTransition;

let caches;
let seededCache;

describe('ReactInteractionTracing', () => {
  function stringifyDeletions(deletions) {
    return deletions
      .map(
        d =>
          `{${Object.keys(d)
            .map(key => `${key}: ${d[key]}`)
            .sort()
            .join(', ')}}`,
      )
      .join(', ');
  }
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');

    act = require('jest-react').act;

    useState = React.useState;
    startTransition = React.startTransition;
    Suspense = React.Suspense;
    Offscreen = React.unstable_Offscreen;

    getCacheForType = React.unstable_getCacheForType;

    caches = [];
    seededCache = null;
  });

  function createTextCache() {
    if (seededCache !== null) {
      const cache = seededCache;
      seededCache = null;
      return cache;
    }

    const data = new Map();
    const cache = {
      data,
      resolve(text) {
        const record = data.get(text);

        if (record === undefined) {
          const newRecord = {
            status: 'resolved',
            value: text,
          };
          data.set(text, newRecord);
        } else if (record.status === 'pending') {
          const thenable = record.value;
          record.status = 'resolved';
          record.value = text;
          thenable.pings.forEach(t => t());
        }
      },
      reject(text, error) {
        const record = data.get(text);
        if (record === undefined) {
          const newRecord = {
            status: 'rejected',
            value: error,
          };
          data.set(text, newRecord);
        } else if (record.status === 'pending') {
          const thenable = record.value;
          record.status = 'rejected';
          record.value = error;
          thenable.pings.forEach(t => t());
        }
      },
    };
    caches.push(cache);
    return cache;
  }

  function readText(text) {
    const textCache = getCacheForType(createTextCache);
    const record = textCache.data.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          Scheduler.unstable_yieldValue(`Suspend [${text}]`);
          throw record.value;
        case 'rejected':
          Scheduler.unstable_yieldValue(`Error [${text}]`);
          throw record.value;
        case 'resolved':
          return record.value;
      }
    } else {
      Scheduler.unstable_yieldValue(`Suspend [${text}]`);

      const thenable = {
        pings: [],
        then(resolve) {
          if (newRecord.status === 'pending') {
            thenable.pings.push(resolve);
          } else {
            Promise.resolve().then(() => resolve(newRecord.value));
          }
        },
      };

      const newRecord = {
        status: 'pending',
        value: thenable,
      };
      textCache.data.set(text, newRecord);

      throw thenable;
    }
  }

  function AsyncText({text}) {
    const fullText = readText(text);
    Scheduler.unstable_yieldValue(fullText);
    return fullText;
  }

  function Text({text}) {
    Scheduler.unstable_yieldValue(text);
    return text;
  }

  function resolveMostRecentTextCache(text) {
    if (caches.length === 0) {
      throw Error('Cache does not exist');
    } else {
      // Resolve the most recently created cache. An older cache can by
      // resolved with `caches[index].resolve(text)`.
      caches[caches.length - 1].resolve(text);
    }
  }

  const resolveText = resolveMostRecentTextCache;

  function advanceTimers(ms) {
    // Note: This advances Jest's virtual time but not React's. Use
    // ReactNoop.expire for that.
    if (typeof ms !== 'number') {
      throw new Error('Must specify ms');
    }
    jest.advanceTimersByTime(ms);
    // Wait until the end of the current tick
    // We cannot use a timer since we're faking them
    return Promise.resolve().then(() => {});
  }

  // @gate enableTransitionTracing
  it(' should not call callbacks when transition is not defined', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    function App({navigate}) {
      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="marker">
              <Text text="Page Two" />
            </React.unstable_TracingMarker>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App navigate={false} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield(['Page One']);

      await act(async () => {
        startTransition(() => root.render(<App navigate={true} />));

        ReactNoop.expire(1000);
        await advanceTimers(1000);

        // Doesn't call transition or marker code
        expect(Scheduler).toFlushAndYield(['Page Two']);

        startTransition(() => root.render(<App navigate={false} />), {
          name: 'transition',
        });
        expect(Scheduler).toFlushAndYield([
          'Page One',
          'onTransitionStart(transition, 2000)',
          'onTransitionComplete(transition, 2000, 2000)',
        ]);
      });
    });
  });

  // @gate enableTransitionTracing
  it('should correctly trace basic interaction', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateToPageTwo;
    function App() {
      const [navigate, setNavigate] = useState(false);
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      return (
        <div>
          {navigate ? <Text text="Page Two" /> : <Text text="Page One" />}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield(['Page One']);

      await act(async () => {
        startTransition(() => navigateToPageTwo(), {name: 'page transition'});

        ReactNoop.expire(1000);
        await advanceTimers(1000);

        expect(Scheduler).toFlushAndYield([
          'Page Two',
          'onTransitionStart(page transition, 1000)',
          'onTransitionComplete(page transition, 1000, 2000)',
        ]);
      });
    });
  });

  // @gate enableTransitionTracing
  it('multiple updates in transition callback should only result in one transitionStart/transitionComplete call', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateToPageTwo;
    let setText;
    function App() {
      const [navigate, setNavigate] = useState(false);
      const [text, _setText] = useState('hide');
      navigateToPageTwo = () => setNavigate(true);
      setText = () => _setText('show');

      return (
        <div>
          {navigate ? (
            <Text text={`Page Two: ${text}`} />
          ) : (
            <Text text={`Page One: ${text}`} />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield(['Page One: hide']);

      await act(async () => {
        startTransition(
          () => {
            navigateToPageTwo();
            setText();
          },
          {name: 'page transition'},
        );

        ReactNoop.expire(1000);
        await advanceTimers(1000);

        expect(Scheduler).toFlushAndYield([
          'Page Two: show',
          'onTransitionStart(page transition, 1000)',
          'onTransitionComplete(page transition, 1000, 2000)',
        ]);
      });
    });
  });

  // @gate enableTransitionTracing
  it('should correctly trace interactions for async roots', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };
    let navigateToPageTwo;
    function App() {
      const [navigate, setNavigate] = useState(false);
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      return (
        <div>
          {navigate ? (
            <Suspense
              fallback={<Text text="Loading..." />}
              unstable_name="suspense page">
              <AsyncText text="Page Two" />
            </Suspense>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield(['Page One']);
    });

    await act(async () => {
      startTransition(() => navigateToPageTwo(), {name: 'page transition'});

      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Suspend [Page Two]',
        'Loading...',
        'onTransitionStart(page transition, 1000)',
        'onTransitionProgress(page transition, 1000, 2000, [suspense page])',
      ]);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await resolveText('Page Two');

      expect(Scheduler).toFlushAndYield([
        'Page Two',
        'onTransitionProgress(page transition, 1000, 3000, [])',
        'onTransitionComplete(page transition, 1000, 3000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('should correctly trace multiple separate root interactions', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateToPageTwo;
    let showTextFn;
    function App() {
      const [navigate, setNavigate] = useState(false);
      const [showText, setShowText] = useState(false);

      navigateToPageTwo = () => {
        setNavigate(true);
      };

      showTextFn = () => {
        setShowText(true);
      };

      return (
        <div>
          {navigate ? (
            <>
              {showText ? (
                <Suspense
                  unstable_name="show text"
                  fallback={<Text text="Show Text Loading..." />}>
                  <AsyncText text="Show Text" />
                </Suspense>
              ) : null}
              <Suspense
                fallback={<Text text="Loading..." />}
                unstable_name="suspense page">
                <AsyncText text="Page Two" />
              </Suspense>
            </>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield(['Page One']);
    });

    await act(async () => {
      startTransition(() => navigateToPageTwo(), {name: 'page transition'});

      expect(Scheduler).toFlushAndYield([
        'Suspend [Page Two]',
        'Loading...',
        'onTransitionStart(page transition, 1000)',
        'onTransitionProgress(page transition, 1000, 1000, [suspense page])',
      ]);

      await resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Page Two',
        'onTransitionProgress(page transition, 1000, 2000, [])',
        'onTransitionComplete(page transition, 1000, 2000)',
      ]);

      startTransition(() => showTextFn(), {name: 'text transition'});
      expect(Scheduler).toFlushAndYield([
        'Suspend [Show Text]',
        'Show Text Loading...',
        'Page Two',
        'onTransitionStart(text transition, 2000)',
        'onTransitionProgress(text transition, 2000, 2000, [show text])',
      ]);

      await resolveText('Show Text');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Show Text',
        'onTransitionProgress(text transition, 2000, 3000, [])',
        'onTransitionComplete(text transition, 2000, 3000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('should correctly trace multiple intertwined root interactions', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };
    let navigateToPageTwo;
    let showTextFn;
    function App() {
      const [navigate, setNavigate] = useState(false);
      const [showText, setShowText] = useState(false);
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      showTextFn = () => {
        setShowText(true);
      };

      return (
        <div>
          {navigate ? (
            <>
              {showText ? (
                <Suspense
                  unstable_name="show text"
                  fallback={<Text text="Show Text Loading..." />}>
                  <AsyncText text="Show Text" />
                </Suspense>
              ) : null}
              <Suspense
                fallback={<Text text="Loading..." />}
                unstable_name="suspense page">
                <AsyncText text="Page Two" />
              </Suspense>
            </>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield(['Page One']);
    });

    await act(async () => {
      startTransition(() => navigateToPageTwo(), {name: 'page transition'});
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Suspend [Page Two]',
        'Loading...',
        'onTransitionStart(page transition, 1000)',
        'onTransitionProgress(page transition, 1000, 2000, [suspense page])',
      ]);
    });

    await act(async () => {
      startTransition(() => showTextFn(), {name: 'show text'});

      expect(Scheduler).toFlushAndYield([
        'Suspend [Show Text]',
        'Show Text Loading...',
        'Suspend [Page Two]',
        'Loading...',
        'onTransitionStart(show text, 2000)',
        'onTransitionProgress(show text, 2000, 2000, [show text])',
      ]);
    });

    await act(async () => {
      await resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Page Two',
        'onTransitionProgress(page transition, 1000, 3000, [])',
        'onTransitionComplete(page transition, 1000, 3000)',
      ]);

      await resolveText('Show Text');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Show Text',
        'onTransitionProgress(show text, 2000, 4000, [])',
        'onTransitionComplete(show text, 2000, 4000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('trace interaction with nested and sibling suspense boundaries', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateToPageTwo;
    function App() {
      const [navigate, setNavigate] = useState(false);
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      return (
        <div>
          {navigate ? (
            <>
              <Suspense
                fallback={<Text text="Loading..." />}
                unstable_name="suspense page">
                <AsyncText text="Page Two" />
                <Suspense
                  unstable_name="show text one"
                  fallback={<Text text="Show Text One Loading..." />}>
                  <AsyncText text="Show Text One" />
                </Suspense>
                <div>
                  <Suspense
                    unstable_name="show text two"
                    fallback={<Text text="Show Text Two Loading..." />}>
                    <AsyncText text="Show Text Two" />
                  </Suspense>
                </div>
              </Suspense>
            </>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield(['Page One']);
    });

    await act(async () => {
      startTransition(() => navigateToPageTwo(), {name: 'page transition'});
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Suspend [Page Two]',
        'Suspend [Show Text One]',
        'Show Text One Loading...',
        'Suspend [Show Text Two]',
        'Show Text Two Loading...',
        'Loading...',
        'onTransitionStart(page transition, 1000)',
        'onTransitionProgress(page transition, 1000, 2000, [suspense page])',
      ]);

      resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Page Two',
        'Suspend [Show Text One]',
        'Show Text One Loading...',
        'Suspend [Show Text Two]',
        'Show Text Two Loading...',
        'onTransitionProgress(page transition, 1000, 3000, [show text one, show text two])',
      ]);

      resolveText('Show Text One');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Show Text One',
        'onTransitionProgress(page transition, 1000, 4000, [show text two])',
      ]);

      resolveText('Show Text Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Show Text Two',
        'onTransitionProgress(page transition, 1000, 5000, [])',
        'onTransitionComplete(page transition, 1000, 5000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('trace interactions with the same child suspense boundaries', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let setNavigate;
    let setShowTextOne;
    let setShowTextTwo;
    function App() {
      const [navigate, _setNavigate] = useState(false);
      const [showTextOne, _setShowTextOne] = useState(false);
      const [showTextTwo, _setShowTextTwo] = useState(false);

      setNavigate = () => _setNavigate(true);
      setShowTextOne = () => _setShowTextOne(true);
      setShowTextTwo = () => _setShowTextTwo(true);

      return (
        <div>
          {navigate ? (
            <>
              <Suspense
                fallback={<Text text="Loading..." />}
                unstable_name="suspense page">
                <AsyncText text="Page Two" />
                {/* showTextOne is entangled with navigate */}
                {showTextOne ? (
                  <Suspense
                    unstable_name="show text one"
                    fallback={<Text text="Show Text One Loading..." />}>
                    <AsyncText text="Show Text One" />
                  </Suspense>
                ) : null}
                <Suspense fallback={<Text text="Show Text Loading..." />}>
                  <AsyncText text="Show Text" />
                </Suspense>
                {/* showTextTwo's suspense boundaries shouldn't stop navigate's suspense boundaries
                 from completing */}
                {showTextTwo ? (
                  <Suspense
                    unstable_name="show text two"
                    fallback={<Text text="Show Text Two Loading..." />}>
                    <AsyncText text="Show Text Two" />
                  </Suspense>
                ) : null}
              </Suspense>
            </>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield(['Page One']);
    });

    await act(async () => {
      startTransition(() => setNavigate(), {name: 'navigate'});
      startTransition(() => setShowTextOne(), {name: 'show text one'});
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Suspend [Page Two]',
        'Suspend [Show Text One]',
        'Show Text One Loading...',
        'Suspend [Show Text]',
        'Show Text Loading...',
        'Loading...',
        'onTransitionStart(navigate, 1000)',
        'onTransitionStart(show text one, 1000)',
        'onTransitionProgress(navigate, 1000, 2000, [suspense page])',
        'onTransitionProgress(show text one, 1000, 2000, [suspense page])',
      ]);

      resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Page Two',
        'Suspend [Show Text One]',
        'Show Text One Loading...',
        'Suspend [Show Text]',
        'Show Text Loading...',
        'onTransitionProgress(navigate, 1000, 3000, [show text one, <null>])',
        'onTransitionProgress(show text one, 1000, 3000, [show text one, <null>])',
      ]);

      startTransition(() => setShowTextTwo(), {name: 'show text two'});
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Page Two',
        'Suspend [Show Text One]',
        'Show Text One Loading...',
        'Suspend [Show Text]',
        'Show Text Loading...',
        'Suspend [Show Text Two]',
        'Show Text Two Loading...',
        'onTransitionStart(show text two, 3000)',
        'onTransitionProgress(show text two, 3000, 4000, [show text two])',
      ]);

      // This should not cause navigate to finish because it's entangled with
      // show text one
      resolveText('Show Text');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Show Text',
        'onTransitionProgress(navigate, 1000, 5000, [show text one])',
        'onTransitionProgress(show text one, 1000, 5000, [show text one])',
      ]);

      // This should not cause show text two to finish but nothing else
      resolveText('Show Text Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Show Text Two',
        'onTransitionProgress(show text two, 3000, 6000, [])',
        'onTransitionComplete(show text two, 3000, 6000)',
      ]);

      // This should cause everything to finish
      resolveText('Show Text One');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Show Text One',
        'onTransitionProgress(navigate, 1000, 7000, [])',
        'onTransitionProgress(show text one, 1000, 7000, [])',
        'onTransitionComplete(navigate, 1000, 7000)',
        'onTransitionComplete(show text one, 1000, 7000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('should correctly trace basic interaction with tracing markers', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateToPageTwo;
    function App() {
      const [navigate, setNavigate] = useState(false);
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="marker two" key="marker two">
              <Text text="Page Two" />
            </React.unstable_TracingMarker>
          ) : (
            <React.unstable_TracingMarker name="marker one">
              <Text text="Page One" />
            </React.unstable_TracingMarker>
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield(['Page One']);

      await act(async () => {
        startTransition(() => navigateToPageTwo(), {name: 'page transition'});

        ReactNoop.expire(1000);
        await advanceTimers(1000);

        expect(Scheduler).toFlushAndYield([
          'Page Two',
          'onTransitionStart(page transition, 1000)',
          'onMarkerComplete(page transition, marker two, 1000, 2000)',
          'onTransitionComplete(page transition, 1000, 2000)',
        ]);
      });
    });
  });

  // @gate enableTransitionTracing
  it('should correctly trace interactions for tracing markers', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };
    let navigateToPageTwo;
    function App() {
      const [navigate, setNavigate] = useState(false);
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      return (
        <div>
          {navigate ? (
            <Suspense
              fallback={<Text text="Loading..." />}
              unstable_name="suspense page">
              <AsyncText text="Page Two" />
              <React.unstable_TracingMarker name="sync marker" />
              <React.unstable_TracingMarker name="async marker">
                <Suspense
                  fallback={<Text text="Loading..." />}
                  unstable_name="marker suspense">
                  <AsyncText text="Marker Text" />
                </Suspense>
              </React.unstable_TracingMarker>
            </Suspense>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield(['Page One']);
    });

    await act(async () => {
      startTransition(() => navigateToPageTwo(), {name: 'page transition'});

      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Suspend [Page Two]',
        'Suspend [Marker Text]',
        'Loading...',
        'Loading...',
        'onTransitionStart(page transition, 1000)',
      ]);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await resolveText('Page Two');

      expect(Scheduler).toFlushAndYield([
        'Page Two',
        'Suspend [Marker Text]',
        'Loading...',
        'onMarkerProgress(page transition, async marker, 1000, 3000, [marker suspense])',
        'onMarkerComplete(page transition, sync marker, 1000, 3000)',
      ]);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await resolveText('Marker Text');

      expect(Scheduler).toFlushAndYield([
        'Marker Text',
        'onMarkerProgress(page transition, async marker, 1000, 4000, [])',
        'onMarkerComplete(page transition, async marker, 1000, 4000)',
        'onTransitionComplete(page transition, 1000, 4000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('trace interaction with multiple tracing markers', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateToPageTwo;
    function App() {
      const [navigate, setNavigate] = useState(false);
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="outer marker">
              <Suspense
                fallback={<Text text="Outer..." />}
                unstable_name="outer">
                <AsyncText text="Outer Text" />
                <Suspense
                  fallback={<Text text="Inner One..." />}
                  unstable_name="inner one">
                  <React.unstable_TracingMarker name="marker one">
                    <AsyncText text="Inner Text One" />
                  </React.unstable_TracingMarker>
                </Suspense>
                <Suspense
                  fallback={<Text text="Inner Two..." />}
                  unstable_name="inner two">
                  <React.unstable_TracingMarker name="marker two">
                    <AsyncText text="Inner Text Two" />
                  </React.unstable_TracingMarker>
                </Suspense>
              </Suspense>
            </React.unstable_TracingMarker>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield(['Page One']);
    });

    await act(async () => {
      startTransition(() => navigateToPageTwo(), {name: 'page transition'});

      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Suspend [Outer Text]',
        'Suspend [Inner Text One]',
        'Inner One...',
        'Suspend [Inner Text Two]',
        'Inner Two...',
        'Outer...',
        'onTransitionStart(page transition, 1000)',
        'onMarkerProgress(page transition, outer marker, 1000, 2000, [outer])',
      ]);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await resolveText('Inner Text Two');
      expect(Scheduler).toFlushAndYield([]);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await resolveText('Outer Text');
      expect(Scheduler).toFlushAndYield([
        'Outer Text',
        'Suspend [Inner Text One]',
        'Inner One...',
        'Inner Text Two',
        'onMarkerProgress(page transition, outer marker, 1000, 4000, [inner one])',
        'onMarkerComplete(page transition, marker two, 1000, 4000)',
      ]);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await resolveText('Inner Text One');
      expect(Scheduler).toFlushAndYield([
        'Inner Text One',
        'onMarkerProgress(page transition, outer marker, 1000, 5000, [])',
        'onMarkerComplete(page transition, marker one, 1000, 5000)',
        'onMarkerComplete(page transition, outer marker, 1000, 5000)',
        'onTransitionComplete(page transition, 1000, 5000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it.skip('warn and calls marker incomplete if name changes before transition completes', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.unstable_yieldValue(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime}, [${stringifyDeletions(
            deletions,
          )}])`,
        );
      },
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    function App({navigate, markerName}) {
      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name={markerName}>
              <Suspense fallback={<Text text="Loading..." />}>
                <AsyncText text="Page Two" />
              </Suspense>
            </React.unstable_TracingMarker>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App navigate={false} markerName="marker one" />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield(['Page One']);

      startTransition(
        () => root.render(<App navigate={true} markerName="marker one" />),
        {
          name: 'transition one',
        },
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Suspend [Page Two]',
        'Loading...',
        'onTransitionStart(transition one, 1000)',
        'onMarkerProgress(transition one, marker one, 1000, 2000, [<null>])',
        'onTransitionProgress(transition one, 1000, 2000, [<null>])',
      ]);

      root.render(<App navigate={true} markerName="marker two" />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(() =>
        expect(Scheduler).toFlushAndYield([
          'Suspend [Page Two]',
          'Loading...',
          'onMarkerIncomplete(transition one, marker one, 1000, [{endTime: 3000, name: marker one, newName: marker two, type: marker}])',
        ]),
      ).toErrorDev('');

      resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Page Two',
        'onMarkerProgress(transition one, marker one, 1000, 4000, [])',
        'onTransitionProgress(transition one, 1000, 4000, [])',
        'onTransitionComplete(transition one, 1000, 4000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('marker incomplete for tree with parent and sibling tracing markers', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.unstable_yieldValue(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime}, [${stringifyDeletions(
            deletions,
          )}])`,
        );
      },
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    function App({navigate, showMarker}) {
      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="parent">
              {showMarker ? (
                <React.unstable_TracingMarker name="marker one">
                  <Suspense
                    unstable_name="suspense page"
                    fallback={<Text text="Loading..." />}>
                    <AsyncText text="Page Two" />
                  </Suspense>
                </React.unstable_TracingMarker>
              ) : (
                <Suspense
                  unstable_name="suspense page"
                  fallback={<Text text="Loading..." />}>
                  <AsyncText text="Page Two" />
                </Suspense>
              )}
              <React.unstable_TracingMarker name="sibling">
                <Suspense
                  unstable_name="suspense sibling"
                  fallback={<Text text="Sibling Loading..." />}>
                  <AsyncText text="Sibling Text" />
                </Suspense>
              </React.unstable_TracingMarker>
            </React.unstable_TracingMarker>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App navigate={false} showMarker={true} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield(['Page One']);

      startTransition(
        () => root.render(<App navigate={true} showMarker={true} />),
        {
          name: 'transition one',
        },
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Suspend [Page Two]',
        'Loading...',
        'Suspend [Sibling Text]',
        'Sibling Loading...',
        'onTransitionStart(transition one, 1000)',
        'onMarkerProgress(transition one, parent, 1000, 2000, [suspense page, suspense sibling])',
        'onMarkerProgress(transition one, marker one, 1000, 2000, [suspense page])',
        'onMarkerProgress(transition one, sibling, 1000, 2000, [suspense sibling])',
        'onTransitionProgress(transition one, 1000, 2000, [suspense page, suspense sibling])',
      ]);
      root.render(<App navigate={true} showMarker={false} />);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Suspend [Page Two]',
        'Loading...',
        'Suspend [Sibling Text]',
        'Sibling Loading...',
        'onMarkerProgress(transition one, parent, 1000, 3000, [suspense sibling])',
        'onMarkerIncomplete(transition one, marker one, 1000, [{endTime: 3000, name: marker one, type: marker}, {endTime: 3000, name: suspense page, type: suspense}])',
        'onMarkerIncomplete(transition one, parent, 1000, [{endTime: 3000, name: marker one, type: marker}, {endTime: 3000, name: suspense page, type: suspense}])',
      ]);

      root.render(<App navigate={true} showMarker={true} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Suspend [Page Two]',
        'Loading...',
        'Suspend [Sibling Text]',
        'Sibling Loading...',
      ]);
    });

    resolveText('Page Two');
    ReactNoop.expire(1000);
    await advanceTimers(1000);
    expect(Scheduler).toFlushAndYield(['Page Two']);

    resolveText('Sibling Text');
    ReactNoop.expire(1000);
    await advanceTimers(1000);
    expect(Scheduler).toFlushAndYield([
      'Sibling Text',
      'onMarkerProgress(transition one, parent, 1000, 6000, [])',
      'onMarkerProgress(transition one, sibling, 1000, 6000, [])',
      // Calls markerComplete and transitionComplete for all parents
      'onMarkerComplete(transition one, sibling, 1000, 6000)',
      'onTransitionProgress(transition one, 1000, 6000, [])',
    ]);
  });

  // @gate enableTransitionTracing
  it('marker gets deleted', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.unstable_yieldValue(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime}, [${stringifyDeletions(
            deletions,
          )}])`,
        );
      },
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    function App({navigate, deleteOne}) {
      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="parent">
              {!deleteOne ? (
                <div>
                  <React.unstable_TracingMarker name="one">
                    <Suspense
                      unstable_name="suspense one"
                      fallback={<Text text="Loading One..." />}>
                      <AsyncText text="Page One" />
                    </Suspense>
                  </React.unstable_TracingMarker>
                </div>
              ) : null}
              <React.unstable_TracingMarker name="two">
                <Suspense
                  unstable_name="suspense two"
                  fallback={<Text text="Loading Two..." />}>
                  <AsyncText text="Page Two" />
                </Suspense>
              </React.unstable_TracingMarker>
            </React.unstable_TracingMarker>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }
    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App navigate={false} deleteOne={false} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield(['Page One']);

      startTransition(
        () => root.render(<App navigate={true} deleteOne={false} />),
        {
          name: 'transition',
        },
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Suspend [Page One]',
        'Loading One...',
        'Suspend [Page Two]',
        'Loading Two...',
        'onTransitionStart(transition, 1000)',
        'onMarkerProgress(transition, parent, 1000, 2000, [suspense one, suspense two])',
        'onMarkerProgress(transition, one, 1000, 2000, [suspense one])',
        'onMarkerProgress(transition, two, 1000, 2000, [suspense two])',
        'onTransitionProgress(transition, 1000, 2000, [suspense one, suspense two])',
      ]);

      root.render(<App navigate={true} deleteOne={true} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Suspend [Page Two]',
        'Loading Two...',
        'onMarkerProgress(transition, parent, 1000, 3000, [suspense two])',
        'onMarkerIncomplete(transition, one, 1000, [{endTime: 3000, name: one, type: marker}, {endTime: 3000, name: suspense one, type: suspense}])',
        'onMarkerIncomplete(transition, parent, 1000, [{endTime: 3000, name: one, type: marker}, {endTime: 3000, name: suspense one, type: suspense}])',
      ]);

      await resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Page Two',
        // Marker progress will still get called after incomplete but not marker complete
        'onMarkerProgress(transition, parent, 1000, 4000, [])',
        'onMarkerProgress(transition, two, 1000, 4000, [])',
        'onMarkerComplete(transition, two, 1000, 4000)',
        // Transition progress will still get called after incomplete but not transition complete
        'onTransitionProgress(transition, 1000, 4000, [])',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('Suspense boundary added by the transition is deleted', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.unstable_yieldValue(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime}, [${stringifyDeletions(
            deletions,
          )}])`,
        );
      },
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    function App({navigate, deleteOne}) {
      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="parent">
              <React.unstable_TracingMarker name="one">
                {!deleteOne ? (
                  <Suspense
                    unstable_name="suspense one"
                    fallback={<Text text="Loading One..." />}>
                    <AsyncText text="Page One" />
                    <React.unstable_TracingMarker name="page one" />
                    <Suspense
                      unstable_name="suspense child"
                      fallback={<Text text="Loading Child..." />}>
                      <React.unstable_TracingMarker name="child" />
                      <AsyncText text="Child" />
                    </Suspense>
                  </Suspense>
                ) : null}
              </React.unstable_TracingMarker>
              <React.unstable_TracingMarker name="two">
                <Suspense
                  unstable_name="suspense two"
                  fallback={<Text text="Loading Two..." />}>
                  <AsyncText text="Page Two" />
                </Suspense>
              </React.unstable_TracingMarker>
            </React.unstable_TracingMarker>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }
    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App navigate={false} deleteOne={false} />);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield(['Page One']);

      startTransition(
        () => root.render(<App navigate={true} deleteOne={false} />),
        {
          name: 'transition',
        },
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Suspend [Page One]',
        'Suspend [Child]',
        'Loading Child...',
        'Loading One...',
        'Suspend [Page Two]',
        'Loading Two...',
        'onTransitionStart(transition, 1000)',
        'onMarkerProgress(transition, parent, 1000, 2000, [suspense one, suspense two])',
        'onMarkerProgress(transition, one, 1000, 2000, [suspense one])',
        'onMarkerProgress(transition, two, 1000, 2000, [suspense two])',
        'onTransitionProgress(transition, 1000, 2000, [suspense one, suspense two])',
      ]);

      await resolveText('Page One');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Page One',
        'Suspend [Child]',
        'Loading Child...',
        'onMarkerProgress(transition, parent, 1000, 3000, [suspense two, suspense child])',
        'onMarkerProgress(transition, one, 1000, 3000, [suspense child])',
        'onMarkerComplete(transition, page one, 1000, 3000)',
        'onTransitionProgress(transition, 1000, 3000, [suspense two, suspense child])',
      ]);

      root.render(<App navigate={true} deleteOne={true} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Suspend [Page Two]',
        'Loading Two...',
        // "suspense one" has unsuspended so shouldn't be included
        // tracing marker "page one" has completed so shouldn't be included
        // all children of "suspense child" haven't yet been rendered so shouldn't be included
        'onMarkerProgress(transition, one, 1000, 4000, [])',
        'onMarkerProgress(transition, parent, 1000, 4000, [suspense two])',
        'onMarkerIncomplete(transition, one, 1000, [{endTime: 4000, name: suspense child, type: suspense}])',
        'onMarkerIncomplete(transition, parent, 1000, [{endTime: 4000, name: suspense child, type: suspense}])',
      ]);

      await resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'Page Two',
        'onMarkerProgress(transition, parent, 1000, 5000, [])',
        'onMarkerProgress(transition, two, 1000, 5000, [])',
        'onMarkerComplete(transition, two, 1000, 5000)',
        'onTransitionProgress(transition, 1000, 5000, [])',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('Suspense boundary not added by the transition is deleted ', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.unstable_yieldValue(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime}, [${stringifyDeletions(
            deletions,
          )}])`,
        );
      },
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    function App({show}) {
      return (
        <React.unstable_TracingMarker name="parent">
          {show ? (
            <Suspense unstable_name="appended child">
              <AsyncText text="Appended child" />
            </Suspense>
          ) : null}
          <Suspense unstable_name="child">
            <AsyncText text="Child" />
          </Suspense>
        </React.unstable_TracingMarker>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      startTransition(() => root.render(<App show={false} />), {
        name: 'transition',
      });
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Suspend [Child]',
        'onTransitionStart(transition, 0)',
        'onMarkerProgress(transition, parent, 0, 1000, [child])',
        'onTransitionProgress(transition, 0, 1000, [child])',
      ]);

      root.render(<App show={true} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      // This appended child isn't part of the transition so we
      // don't call any callback
      expect(Scheduler).toFlushAndYield([
        'Suspend [Appended child]',
        'Suspend [Child]',
      ]);

      // This deleted child isn't part of the transition so we
      // don't call any callbacks
      root.render(<App show={false} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield(['Suspend [Child]']);

      await resolveText('Child');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      expect(Scheduler).toFlushAndYield([
        'Child',
        'onMarkerProgress(transition, parent, 0, 4000, [])',
        'onMarkerComplete(transition, parent, 0, 4000)',
        'onTransitionProgress(transition, 0, 4000, [])',
        'onTransitionComplete(transition, 0, 4000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('marker incomplete gets called properly if child suspense marker is not part of it', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.unstable_yieldValue(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime}, [${stringifyDeletions(
            deletions,
          )}])`,
        );
      },
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    function App({show, showSuspense}) {
      return (
        <React.unstable_TracingMarker name="parent">
          {show ? (
            <React.unstable_TracingMarker name="appended child">
              {showSuspense ? (
                <Suspense unstable_name="appended child">
                  <AsyncText text="Appended child" />
                </Suspense>
              ) : null}
            </React.unstable_TracingMarker>
          ) : null}
          <Suspense unstable_name="child">
            <AsyncText text="Child" />
          </Suspense>
        </React.unstable_TracingMarker>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });

    await act(async () => {
      startTransition(
        () => root.render(<App show={false} showSuspense={false} />),
        {
          name: 'transition one',
        },
      );

      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    expect(Scheduler).toHaveYielded([
      'Suspend [Child]',
      'onTransitionStart(transition one, 0)',
      'onMarkerProgress(transition one, parent, 0, 1000, [child])',
      'onTransitionProgress(transition one, 0, 1000, [child])',
    ]);

    await act(async () => {
      startTransition(
        () => root.render(<App show={true} showSuspense={true} />),
        {
          name: 'transition two',
        },
      );

      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    expect(Scheduler).toHaveYielded([
      'Suspend [Appended child]',
      'Suspend [Child]',
      'onTransitionStart(transition two, 1000)',
      'onMarkerProgress(transition two, appended child, 1000, 2000, [appended child])',
      'onTransitionProgress(transition two, 1000, 2000, [appended child])',
    ]);

    await act(async () => {
      root.render(<App show={true} showSuspense={false} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    expect(Scheduler).toHaveYielded([
      'Suspend [Child]',
      'onMarkerProgress(transition two, appended child, 1000, 3000, [])',
      'onMarkerIncomplete(transition two, appended child, 1000, [{endTime: 3000, name: appended child, type: suspense}])',
    ]);

    await act(async () => {
      resolveText('Child');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    expect(Scheduler).toHaveYielded([
      'Child',
      'onMarkerProgress(transition one, parent, 0, 4000, [])',
      'onMarkerComplete(transition one, parent, 0, 4000)',
      'onTransitionProgress(transition one, 0, 4000, [])',
      'onTransitionComplete(transition one, 0, 4000)',
    ]);
  });

  // @gate enableTransitionTracing
  it('warns when marker name changes', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.unstable_yieldValue(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime}, [${stringifyDeletions(
            deletions,
          )}])`,
        );
      },
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };
    function App({markerName, markerKey}) {
      return (
        <React.unstable_TracingMarker name={markerName} key={markerKey}>
          <Text text={markerName} />
        </React.unstable_TracingMarker>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      startTransition(
        () => root.render(<App markerName="one" markerKey="key" />),
        {
          name: 'transition one',
        },
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(Scheduler).toFlushAndYield([
        'one',
        'onTransitionStart(transition one, 0)',
        'onMarkerComplete(transition one, one, 0, 1000)',
        'onTransitionComplete(transition one, 0, 1000)',
      ]);
      startTransition(
        () => root.render(<App markerName="two" markerKey="key" />),
        {
          name: 'transition two',
        },
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      expect(() => {
        // onMarkerComplete shouldn't be called for transitions with
        // new keys
        expect(Scheduler).toFlushAndYield([
          'two',
          'onTransitionStart(transition two, 1000)',
          'onTransitionComplete(transition two, 1000, 2000)',
        ]);
      }).toErrorDev(
        'Changing the name of a tracing marker after mount is not supported.',
      );
      startTransition(
        () => root.render(<App markerName="three" markerKey="new key" />),
        {
          name: 'transition three',
        },
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      // This should not warn and onMarkerComplete should be called
      expect(Scheduler).toFlushAndYield([
        'three',
        'onTransitionStart(transition three, 2000)',
        'onMarkerComplete(transition three, three, 2000, 3000)',
        'onTransitionComplete(transition three, 2000, 3000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('offscreen trees should not stop transition from completing', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    function App() {
      return (
        <React.unstable_TracingMarker name="marker">
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text="Text" />
          </Suspense>
          <Offscreen mode="hidden">
            <Suspense fallback={<Text text="Hidden Loading..." />}>
              <AsyncText text="Hidden Text" />
            </Suspense>
          </Offscreen>
        </React.unstable_TracingMarker>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(() => {
      startTransition(() => root.render(<App />), {name: 'transition'});
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });
    expect(Scheduler).toHaveYielded([
      'Suspend [Text]',
      'Loading...',
      'Suspend [Hidden Text]',
      'Hidden Loading...',
      'onTransitionStart(transition, 0)',
    ]);

    await act(() => {
      resolveText('Text');
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });
    expect(Scheduler).toHaveYielded([
      'Text',
      'onMarkerComplete(transition, marker, 0, 2000)',
      'onTransitionComplete(transition, 0, 2000)',
    ]);

    await act(() => {
      resolveText('Hidden Text');
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });
    expect(Scheduler).toHaveYielded(['Hidden Text']);
  });

  // @gate enableTransitionTracing
  it('discrete events', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    function App() {
      return (
        <Suspense
          fallback={<Text text="Loading..." />}
          unstable_name="suspense page">
          <AsyncText text="Page Two" />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });

    await act(async () => {
      ReactNoop.discreteUpdates(() =>
        startTransition(() => root.render(<App />), {name: 'page transition'}),
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    expect(Scheduler).toHaveYielded([
      'Suspend [Page Two]',
      'Loading...',
      'onTransitionStart(page transition, 0)',
      'onTransitionProgress(page transition, 0, 1000, [suspense page])',
    ]);
    await act(async () => {
      ReactNoop.discreteUpdates(() => resolveText('Page Two'));
      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    expect(Scheduler).toHaveYielded([
      'Page Two',
      'onTransitionProgress(page transition, 0, 2000, [])',
      'onTransitionComplete(page transition, 0, 2000)',
    ]);
  });

  // @gate enableTransitionTracing
  it('multiple commits happen before a paint', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionStart(${name}, ${startTime})`,
        );
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.unstable_yieldValue(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.unstable_yieldValue(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    function App() {
      const [, setRerender] = useState(false);
      React.useLayoutEffect(() => {
        resolveText('Text');
        setRerender(true);
      });
      return (
        <>
          <Suspense unstable_name="one" fallback={<Text text="Loading..." />}>
            <AsyncText text="Text" />
          </Suspense>
          <Suspense
            unstable_name="two"
            fallback={<Text text="Loading Two..." />}>
            <AsyncText text="Text Two" />
          </Suspense>
        </>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });

    await act(() => {
      startTransition(() => root.render(<App />), {name: 'transition'});
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });

    expect(Scheduler).toHaveYielded([
      'Suspend [Text]',
      'Loading...',
      'Suspend [Text Two]',
      'Loading Two...',
      'Text',
      'Suspend [Text Two]',
      'Loading Two...',
      'onTransitionStart(transition, 0)',
      'onTransitionProgress(transition, 0, 1000, [two])',
    ]);

    await act(() => {
      resolveText('Text Two');
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });
    expect(Scheduler).toHaveYielded([
      'Text Two',
      'onTransitionProgress(transition, 0, 2000, [])',
      'onTransitionComplete(transition, 0, 2000)',
    ]);
  });

  // @gate enableTransitionTracing
  it('transition callbacks work for multiple roots', async () => {
    const getTransitionCallbacks = transitionName => {
      return {
        onTransitionStart: (name, startTime) => {
          Scheduler.unstable_yieldValue(
            `onTransitionStart(${name}, ${startTime}) /${transitionName}/`,
          );
        },
        onTransitionProgress: (name, startTime, endTime, pending) => {
          const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
          Scheduler.unstable_yieldValue(
            `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}]) /${transitionName}/`,
          );
        },
        onTransitionComplete: (name, startTime, endTime) => {
          Scheduler.unstable_yieldValue(
            `onTransitionComplete(${name}, ${startTime}, ${endTime}) /${transitionName}/`,
          );
        },
      };
    };

    function App({name}) {
      return (
        <>
          <Suspense
            unstable_name={name}
            fallback={<Text text={`Loading ${name}...`} />}>
            <AsyncText text={`Text ${name}`} />
          </Suspense>
        </>
      );
    }

    const rootOne = ReactNoop.createRoot({
      unstable_transitionCallbacks: getTransitionCallbacks('root one'),
    });

    const rootTwo = ReactNoop.createRoot({
      unstable_transitionCallbacks: getTransitionCallbacks('root two'),
    });

    await act(() => {
      startTransition(() => rootOne.render(<App name="one" />), {
        name: 'transition one',
      });
      startTransition(() => rootTwo.render(<App name="two" />), {
        name: 'transition two',
      });
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });

    expect(Scheduler).toHaveYielded([
      'Suspend [Text one]',
      'Loading one...',
      'Suspend [Text two]',
      'Loading two...',
      'onTransitionStart(transition one, 0) /root one/',
      'onTransitionProgress(transition one, 0, 1000, [one]) /root one/',
      'onTransitionStart(transition two, 0) /root two/',
      'onTransitionProgress(transition two, 0, 1000, [two]) /root two/',
    ]);

    await act(() => {
      caches[0].resolve('Text one');
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });

    expect(Scheduler).toHaveYielded([
      'Text one',
      'onTransitionProgress(transition one, 0, 2000, []) /root one/',
      'onTransitionComplete(transition one, 0, 2000) /root one/',
    ]);

    await act(() => {
      resolveText('Text two');
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });

    expect(Scheduler).toHaveYielded([
      'Text two',
      'onTransitionProgress(transition two, 0, 3000, []) /root two/',
      'onTransitionComplete(transition two, 0, 3000) /root two/',
    ]);
  });
});
