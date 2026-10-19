import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input, Modal } from './ui';

function TwoFields() {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  // An inline onClose, as callers write it: a new function on every render.
  return (
    <Modal open onClose={() => {}} title="Edit">
      <Input label="First" value={a} onChange={(e) => setA(e.target.value)} />
      <Input label="Second" value={b} onChange={(e) => setB(e.target.value)} />
    </Modal>
  );
}

describe('<Modal>', () => {
  it('keeps focus in the field being typed in (regression: focus jumped back to the first field)', async () => {
    const user = userEvent.setup();
    render(<TwoFields />);
    expect(screen.getByLabelText('First')).toHaveFocus();
    await user.click(screen.getByLabelText('Second'));
    await user.type(screen.getByLabelText('Second'), 'Jollof rice');
    expect(screen.getByLabelText('Second')).toHaveValue('Jollof rice');
    expect(screen.getByLabelText('First')).toHaveValue('');
  });
});
