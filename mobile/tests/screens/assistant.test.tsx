import { screen, waitFor } from '@testing-library/react-native';
import type { TransportRequest, TransportResponse } from '@/api/transport';
import { COPY } from '@/copy/strings';
import { createTrade } from '@/db/mutations';
import { writeUser } from '@/db/user';
import AssistantScreen, {
  ASSISTANT_ANSWER_PREFIX,
  ASSISTANT_CLEAR_TEST_ID,
  ASSISTANT_INPUT_TEST_ID,
  ASSISTANT_SEND_TEST_ID,
  ASSISTANT_SUGGESTION_PREFIX,
} from '../../app/(app)/assistant';
import { apiError, mountScreen, ok, pressOn, typeInto, type MountedScreen } from '../support/mount';
import { resetRouter } from '../support/router';

jest.mock('expo-router');

/**
 * The assistant screen: a question goes to the server with a digest of this device's figures, the answer is
 * shown with its caveats, and a server with no model says so instead of failing.
 */

const NOW = new Date(2026, 10, 6, 9, 0, 0);

type Handler = (request: TransportRequest) => TransportResponse | Promise<TransportResponse>;

function server(onAsk: Handler) {
  return async (request: TransportRequest): Promise<TransportResponse> => {
    if (request.path === '/v1/assistant/ask') return onAsk(request);
    const quote = /^\/v1\/market\/quotes\/(\w+)$/.exec(request.path);
    if (quote?.[1] !== undefined) {
      return ok(200, {
        data: {
          symbol: quote[1],
          source: 'vnstock',
          demo: false,
          asOf: '2026-11-06',
          close: 60000,
          prevClose: 60000,
          changePct: 0,
          high52w: 60000,
          low52w: 60000,
          series: [{ date: '2026-11-06', close: 60000, volume: 1 }],
        },
      });
    }
    throw new Error(`unexpected request ${request.method} ${request.path}`);
  };
}

async function mountAssistant(onAsk: Handler): Promise<MountedScreen> {
  return mountScreen(<AssistantScreen />, {
    clock: () => NOW,
    transport: server(onAsk),
    seed: async (database) => {
      await writeUser(database, {
        id: '0192f5a0-0000-7000-8000-00000000a001',
        email: 'ada@example.com',
        currency: 'VND',
        createdAt: '2026-10-01T00:00:00.000Z',
      });
      await createTrade(database, {
        symbol: 'VNM',
        side: 'buy',
        quantity: 100,
        price: 50000,
        fee: 0,
        date: '2026-11-01',
      });
    },
  });
}

const ANSWER = { data: { answer: '- Ăn uống nhiều nhất.', disclaimer: 'Không phải lời khuyên.' } };

beforeEach(() => resetRouter());

describe('asking', () => {
  it('sends the question with a digest that holds the holding and no notes, and shows the answer', async () => {
    let sent: { question: string; context: string } | null = null;
    await mountAssistant((request) => {
      sent = request.body as { question: string; context: string };
      return ok(200, ANSWER);
    });

    await waitFor(() =>
      expect(
        screen.getByTestId(ASSISTANT_SUGGESTION_PREFIX + '-0').props.accessibilityState?.disabled,
      ).not.toBe(true),
    );
    await typeInto(ASSISTANT_INPUT_TEST_ID, '  Tháng này tiêu gì?  ');
    await pressOn(ASSISTANT_SEND_TEST_ID);

    await waitFor(() => expect(screen.queryByText('- Ăn uống nhiều nhất.')).not.toBeNull());
    expect(screen.getByText('Không phải lời khuyên.')).toBeTruthy();
    expect(screen.getByText(COPY.invest.briefByAi)).toBeTruthy();
    expect(sent).not.toBeNull();
    const asked = sent as unknown as { question: string; context: string };
    expect(asked.question).toBe('Tháng này tiêu gì?');
    expect(asked.context).toMatch(/Tháng 2026-11/);
    expect(asked.context).toMatch(/VNM: 100 cổ phiếu/);
    expect(asked.context).toMatch(/tỷ trọng 100%/);
  });

  it('asks a suggested question with one tap', async () => {
    let question = '';
    await mountAssistant((request) => {
      question = (request.body as { question: string }).question;
      return ok(200, ANSWER);
    });
    await waitFor(() =>
      expect(screen.queryByTestId(ASSISTANT_SUGGESTION_PREFIX + '-0')).not.toBeNull(),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId(ASSISTANT_SUGGESTION_PREFIX + '-0').props.accessibilityState?.disabled,
      ).not.toBe(true),
    );

    await pressOn(ASSISTANT_SUGGESTION_PREFIX + '-0');

    await waitFor(() =>
      expect(screen.queryByTestId(`${ASSISTANT_ANSWER_PREFIX}-1`)).not.toBeNull(),
    );
    expect(question).toBe(COPY.assistant.s1);
  });

  it('says it could not answer when the call fails, and lets the person ask again', async () => {
    let calls = 0;
    await mountAssistant(() => {
      calls += 1;
      return calls === 1 ? apiError(500, 'internal_error') : ok(200, ANSWER);
    });
    await waitFor(() =>
      expect(
        screen.getByTestId(ASSISTANT_SUGGESTION_PREFIX + '-0').props.accessibilityState?.disabled,
      ).not.toBe(true),
    );

    await pressOn(ASSISTANT_SUGGESTION_PREFIX + '-0');
    await waitFor(() => expect(screen.queryByText(COPY.assistant.failed)).not.toBeNull());

    await typeInto(ASSISTANT_INPUT_TEST_ID, 'Thử lại');
    await pressOn(ASSISTANT_SEND_TEST_ID);
    await waitFor(() => expect(screen.queryByText('- Ăn uống nhiều nhất.')).not.toBeNull());
  });

  it('says the server has no assistant, and stops offering to ask', async () => {
    await mountAssistant(() => apiError(503, 'market_unavailable'));
    await waitFor(() =>
      expect(
        screen.getByTestId(ASSISTANT_SUGGESTION_PREFIX + '-0').props.accessibilityState?.disabled,
      ).not.toBe(true),
    );

    await pressOn(ASSISTANT_SUGGESTION_PREFIX + '-0');

    await waitFor(() =>
      expect(screen.getAllByText(COPY.assistant.unavailable).length).toBeGreaterThan(0),
    );
    expect(screen.getByTestId(ASSISTANT_SEND_TEST_ID).props.accessibilityState.disabled).toBe(true);
  });

  it('clears the answers', async () => {
    await mountAssistant(() => ok(200, ANSWER));
    await waitFor(() =>
      expect(
        screen.getByTestId(ASSISTANT_SUGGESTION_PREFIX + '-0').props.accessibilityState?.disabled,
      ).not.toBe(true),
    );
    await pressOn(ASSISTANT_SUGGESTION_PREFIX + '-0');
    await waitFor(() => expect(screen.queryByText('- Ăn uống nhiều nhất.')).not.toBeNull());

    await pressOn(ASSISTANT_CLEAR_TEST_ID);

    expect(screen.queryByText('- Ăn uống nhiều nhất.')).toBeNull();
    expect(screen.queryByTestId(ASSISTANT_SUGGESTION_PREFIX + '-0')).not.toBeNull();
  });
});
