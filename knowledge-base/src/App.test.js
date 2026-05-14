import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

function createResponse(data, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(data),
  });
}

function createFetchMock(initialEntries, assistantResponse) {
  let entries = [...initialEntries];

  return jest.fn((url, options = {}) => {
    const method = options.method || 'GET';
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    const body = options.body ? JSON.parse(options.body) : null;

    if (pathname === '/api/knowledge' && method === 'GET') {
      return createResponse(entries);
    }

    if (pathname === '/api/knowledge' && method === 'POST') {
      const newEntry = {
        id: `page-${entries.length + 1}`,
        deleted_at: null,
        ...body,
      };
      entries = [...entries, newEntry];
      return createResponse(newEntry);
    }

    if (pathname.startsWith('/api/knowledge/') && method === 'PUT') {
      const entryId = pathname.split('/')[3];
      entries = entries.map((entry) =>
        entry.id === entryId ? { ...entry, ...body } : entry
      );
      return createResponse(entries.find((entry) => entry.id === entryId));
    }

    if (pathname.endsWith('/archive') && method === 'POST') {
      const entryId = pathname.split('/')[3];
      entries = entries.map((entry) =>
        entry.id === entryId ? { ...entry, deleted_at: '2026-05-14T00:00:00+00:00' } : entry
      );
      return createResponse(entries.find((entry) => entry.id === entryId));
    }

    if (pathname.endsWith('/restore') && method === 'POST') {
      const entryId = pathname.split('/')[3];
      entries = entries.map((entry) =>
        entry.id === entryId ? { ...entry, deleted_at: null } : entry
      );
      return createResponse(entries.find((entry) => entry.id === entryId));
    }

    if (pathname === '/api/assistant/chat' && method === 'POST') {
      return createResponse(assistantResponse);
    }

    return createResponse({ error: 'Unhandled request' }, false);
  });
}

const activeEntry = {
  id: 'page-1',
  summary: 'SSO redirect loop',
  sf_case: '00123456',
  jira_link: 'https://jira.example.com/OPS-1',
  description: 'Users are sent back to the login page after the redirect.',
  solution: 'Reset the tenant certificate.\nSync the IdP metadata.',
  related_page_ids: [],
  images: [],
  deleted_at: null,
};

const archivedEntry = {
  id: 'page-2',
  summary: 'Archived reference page',
  sf_case: '00999999',
  jira_link: '',
  description: 'An older archived fix.',
  solution: 'Do not use.',
  related_page_ids: [],
  images: [],
  deleted_at: '2026-05-13T00:00:00+00:00',
};

const imageEntry = {
  id: 'page-3',
  summary: 'Screenshot-heavy article',
  sf_case: '00130000',
  jira_link: '',
  description: 'This article has screenshots.',
  solution: 'Follow the visual guide.',
  related_page_ids: [],
  images: ['data:image/png;base64,testimage'],
  deleted_at: null,
};

let popupMock;

beforeEach(() => {
  popupMock = {
    document: {
      write: jest.fn(),
      close: jest.fn(),
    },
    focus: jest.fn(),
  };
  window.open = jest.fn(() => popupMock);
  window.confirm = jest.fn(() => true);
  window.scrollTo = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

test('renders related page selector and saves references on a new page', async () => {
  global.fetch = createFetchMock([activeEntry, archivedEntry], {
    answer: 'Use the SSO redirect loop article. Sources: SSO redirect loop.',
    citations: [{ id: 'page-1', summary: 'SSO redirect loop', sf_case: '00123456' }],
    matched_pages: [{ id: 'page-1', summary: 'SSO redirect loop', sf_case: '00123456' }],
    refusal: false,
  });

  render(<App />);

  expect(
    await screen.findByRole('button', { name: /Open knowledge page SSO redirect loop/i })
  ).toBeInTheDocument();
  expect(screen.queryByText(/Archived reference page/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Summary/i)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /Add new page/i }));

  await userEvent.type(screen.getByLabelText(/Summary/i), 'MFA enrollment timeout');
  await userEvent.type(screen.getByLabelText(/Salesforce Case/i), '00120000');
  await userEvent.type(
    screen.getByLabelText(/Issue definition/i),
    'Enrollment hangs on step 2.'
  );
  await userEvent.type(
    screen.getByLabelText(/Resolution steps/i),
    'Clear the pending MFA challenge.'
  );
  await userEvent.click(screen.getByRole('checkbox', { name: /SSO redirect loop/i }));
  await userEvent.click(screen.getByRole('button', { name: /Save knowledge page/i }));

  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: /Open knowledge page MFA enrollment timeout/i })
    ).toBeInTheDocument();
  });

  expect(screen.getByRole('button', { name: /Open knowledge page SSO redirect loop/i })).toBeInTheDocument();
});

test('archives and restores pages through the filters', async () => {
  global.fetch = createFetchMock([activeEntry], {
    answer: 'Use the SSO redirect loop article. Sources: SSO redirect loop.',
    citations: [{ id: 'page-1', summary: 'SSO redirect loop', sf_case: '00123456' }],
    matched_pages: [{ id: 'page-1', summary: 'SSO redirect loop', sf_case: '00123456' }],
    refusal: false,
  });

  render(<App />);

  expect(
    await screen.findByRole('button', { name: /Open knowledge page SSO redirect loop/i })
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Delete page/i }));

  await waitFor(() => {
    expect(screen.getByText(/No pages match this view/i)).toBeInTheDocument();
  });

  await userEvent.click(screen.getByRole('button', { name: /Archived/i }));
  expect(await screen.findByText(/Restore page/i)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /Restore page/i }));
  await userEvent.click(screen.getByRole('button', { name: /Active/i }));

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /Open knowledge page SSO redirect loop/i })).toBeInTheDocument();
  });
});

test('renders assistant responses with citations', async () => {
  global.fetch = createFetchMock([activeEntry], {
    answer:
      'Reset the tenant certificate and sync the IdP metadata. Sources: SSO redirect loop.',
    citations: [{ id: 'page-1', summary: 'SSO redirect loop', sf_case: '00123456' }],
    matched_pages: [{ id: 'page-1', summary: 'SSO redirect loop', sf_case: '00123456' }],
    refusal: false,
  });

  render(<App />);

  expect(await screen.findByText(/Grounded support chat/i)).toBeInTheDocument();
  await userEvent.type(
    screen.getByPlaceholderText(/Ask about a symptom, a case ID, or the next troubleshooting step/i),
    'How do I fix the SSO redirect loop?'
  );
  await userEvent.click(screen.getByRole('button', { name: /Ask assistant/i }));

  expect(await screen.findByText(/Reset the tenant certificate/i)).toBeInTheDocument();
  expect(screen.getByText(/SSO redirect loop · 00123456/i)).toBeInTheDocument();
});

test('keeps page pictures hidden until the user clicks to reveal them', async () => {
  global.fetch = createFetchMock([imageEntry], {
    answer: 'Use the screenshot-heavy article.',
    citations: [{ id: 'page-3', summary: 'Screenshot-heavy article', sf_case: '00130000' }],
    matched_pages: [{ id: 'page-3', summary: 'Screenshot-heavy article', sf_case: '00130000' }],
    refusal: false,
  });

  render(<App />);

  expect(
    await screen.findByRole('button', { name: /Open knowledge page Screenshot-heavy article/i })
  ).toBeInTheDocument();

  await userEvent.click(
    screen.getByRole('button', { name: /Open knowledge page Screenshot-heavy article/i })
  );

  expect(window.open).toHaveBeenCalled();
  expect(popupMock.document.write).toHaveBeenCalledWith(expect.stringContaining('Screenshot-heavy article'));
  expect(popupMock.document.write).toHaveBeenCalledWith(expect.stringContaining('testimage'));
});

test('opens and closes the creation panel on demand', async () => {
  global.fetch = createFetchMock([activeEntry], {
    answer: 'Use the SSO redirect loop article. Sources: SSO redirect loop.',
    citations: [{ id: 'page-1', summary: 'SSO redirect loop', sf_case: '00123456' }],
    matched_pages: [{ id: 'page-1', summary: 'SSO redirect loop', sf_case: '00123456' }],
    refusal: false,
  });

  render(<App />);

  expect(await screen.findByRole('button', { name: /Add new page/i })).toBeInTheDocument();
  expect(screen.queryByLabelText(/Summary/i)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /Add new page/i }));
  expect(screen.getByLabelText(/Summary/i)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /^Close$/i }));
  expect(screen.queryByLabelText(/Summary/i)).not.toBeInTheDocument();
});
