import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SignupForm from '@/app/npd-mcp/SignupForm';

const fetchMock = vi.fn();

function fill() {
  fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Acme Health' } });
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Pat' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pat@acme.org' } });
  fireEvent.change(screen.getByLabelText('Organization type'), { target: { value: 'payer' } });
}

function okResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SignupForm', () => {
  it('marks the required fields required', () => {
    render(<SignupForm />);
    for (const label of ['Organization name', 'Your name', 'Email', 'Organization type']) {
      expect(screen.getByLabelText(label)).toBeRequired();
    }
    expect(screen.getByLabelText("List our organization's name and type on this page")).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'privacy policy' }).getAttribute('href')).toBe('/privacy');
  });

  it('posts JSON with listPublicly false when the box is unticked, then thanks', async () => {
    fetchMock.mockReturnValue(okResponse({ ok: true }));
    render(<SignupForm />);
    fill();
    fireEvent.click(screen.getByLabelText('Test at the connectathon'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    await screen.findByText("Thanks. You're on the list.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/npd-mcp/participate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      organization: 'Acme Health',
      contactName: 'Pat',
      email: 'pat@acme.org',
      orgType: 'payer',
      participation: ['test'],
      useCase: '',
      listPublicly: false,
      website: '',
    });
    expect(screen.getByRole('button', { name: /Sign up|Sending/ })).toBeDisabled();
  });

  it('sends listPublicly true when the box is ticked', async () => {
    fetchMock.mockReturnValue(okResponse({ ok: true }));
    render(<SignupForm />);
    fill();
    fireEvent.click(screen.getByLabelText("List our organization's name and type on this page"));
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    await screen.findByText("Thanks. You're on the list.");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).listPublicly).toBe(true);
  });

  it('shows the error text from the server', async () => {
    fetchMock.mockReturnValue(okResponse({ ok: false, error: 'Please enter a valid email address.' }, 400));
    render(<SignupForm />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter a valid email address.');
    expect(screen.getByRole('button', { name: 'Sign up' })).not.toBeDisabled();
  });

  it('disables the button in flight, so a double click sends one request', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    render(<SignupForm />);
    fill();
    const button = screen.getByRole('button', { name: 'Sign up' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled());
    resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await screen.findByText("Thanks. You're on the list.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
