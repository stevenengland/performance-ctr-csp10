import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { backToFirstStepFrom, step } from './game-flow';

const blank = { render: () => null };

async function routerAt(...paths: string[]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)*', component: blank }],
  });
  for (const path of paths) await router.push(path);
  return router;
}

/** Waits for a `router.go`, which settles on the history's popstate. */
async function settled(router: Awaited<ReturnType<typeof routerAt>>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await router.isReady();
}

describe('the recording flow’s way back', () => {
  it('takes the walked steps off the history after a save', async () => {
    const router = await routerAt('/spiele/1', '/spiele/1/partie');
    step(router, '/spiele/1/partie/1', '/spiele/1/partie');
    await settled(router);
    step(router, '/spiele/1/partie/1/2');
    await settled(router);

    backToFirstStepFrom(router, '/spiele/1/partie')();
    await settled(router);

    expect(router.currentRoute.value.path).toBe('/spiele/1/partie');
    router.back();
    await settled(router);
    expect(router.currentRoute.value.path).toBe('/spiele/1');
  });

  it('replaces a step opened directly by the first step', async () => {
    const router = await routerAt('/spiele/1/partie/1/2');

    backToFirstStepFrom(router, '/spiele/1/partie')();
    await settled(router);

    expect(router.currentRoute.value.path).toBe('/spiele/1/partie');
  });

  it('leaves the user where they are when the save succeeds after they moved on', async () => {
    const router = await routerAt('/spiele/1/partie/1/2');
    const done = backToFirstStepFrom(router, '/spiele/1/partie');
    await router.push('/rangliste');

    done();
    await settled(router);

    expect(router.currentRoute.value.path).toBe('/rangliste');
  });
});
