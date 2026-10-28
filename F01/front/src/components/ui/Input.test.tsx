import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input, Textarea, Select } from './Input';

describe('Input', () => {
  describe('Basic rendering', () => {
    it('renders input with id', () => {
      render(<Input id="test-input" />);
      expect(screen.getByRole('textbox', { name: '' })).toHaveAttribute('id', 'test-input');
    });

    it('renders label when provided', () => {
      render(<Input id="test-input" label="Test Label" />);
      expect(screen.getByLabelText('Test Label')).toBeInTheDocument();
    });

    it('renders required indicator when required', () => {
      render(<Input id="test-input" label="Test Label" required />);
      expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('applies correct base classes', () => {
      render(<Input id="test-input" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveClass('w-full');
      expect(input).toHaveClass('px-3');
      expect(input).toHaveClass('py-2');
      expect(input).toHaveClass('border');
      expect(input).toHaveClass('rounded-lg');
    });
  });

  describe('Types', () => {
    it('renders text type by default', () => {
      render(<Input id="test-input" />);
      expect(screen.getByRole('textbox')).toHaveAttribute('type', 'text');
    });

    it('renders email type', () => {
      render(<Input id="test-input" type="email" />);
      expect(screen.getByRole('textbox')).toHaveAttribute('type', 'email');
    });

    it('renders password type', () => {
      render(<Input id="test-input" label="Password" type="password" />);
      expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    });

    it('renders number type', () => {
      render(<Input id="test-input" label="Quantity" type="number" />);
      expect(screen.getByRole('spinbutton')).toHaveAttribute('type', 'number');
    });
  });

  describe('Value and onChange', () => {
    it('sets value prop', () => {
      render(<Input id="test-input" value="Test value" readOnly />);
      expect(screen.getByRole('textbox')).toHaveValue('Test value');
    });

    it('calls onChange when value changes', () => {
      const handleChange = vi.fn();
      render(<Input id="test-input" onChange={handleChange} />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New value' } });
      expect(handleChange).toHaveBeenCalled();
    });
  });

  describe('Error state', () => {
    it('shows error message when error prop provided', () => {
      render(<Input id="test-input" error="This field is required" />);
      expect(screen.getByRole('alert')).toHaveTextContent('This field is required');
    });

    it('applies error border class when error provided', () => {
      render(<Input id="test-input" error="Error" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveClass('border-red-500');
    });

    it('sets aria-invalid="true" when error provided', () => {
      render(<Input id="test-input" error="Error" />);
      expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    });

    it('sets aria-describedby to error id when error provided', () => {
      render(<Input id="test-input" error="Error message" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('aria-describedby', 'test-input-error');
    });
  });

  describe('Hint', () => {
    it('shows hint when provided and no error', () => {
      render(<Input id="test-input" hint="Helper text" />);
      expect(screen.getByText('Helper text')).toBeInTheDocument();
    });

    it('does not show hint when error is present', () => {
      render(<Input id="test-input" error="Error" hint="Helper text" />);
      expect(screen.queryByText('Helper text')).not.toBeInTheDocument();
    });

    it('sets aria-describedby to hint id when hint provided and no error', () => {
      render(<Input id="test-input" hint="Helper text" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('aria-describedby', 'test-input-hint');
    });

    it('does not reference a hidden hint when an error is present', () => {
      render(<Input id="test-input" error="Error" hint="Helper" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('aria-describedby', 'test-input-error');
      expect(screen.queryByText('Helper')).not.toBeInTheDocument();
    });
  });

  describe('Disabled state', () => {
    it('disables input when disabled prop is true', () => {
      render(<Input id="test-input" disabled />);
      expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('applies disabled styles', () => {
      render(<Input id="test-input" disabled />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveClass('disabled:bg-gray-50');
      expect(input).toHaveClass('disabled:text-gray-500');
      expect(input).toHaveClass('disabled:cursor-not-allowed');
    });
  });

  describe('Placeholder', () => {
    it('sets placeholder attribute', () => {
      render(<Input id="test-input" placeholder="Enter text" />);
      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Enter text');
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      render(<Input id="test-input" className="custom-input" />);
      expect(screen.getByRole('textbox')).toHaveClass('custom-input');
    });
  });

  describe('Forward ref', () => {
    it('forwards ref to underlying input', () => {
      const ref = vi.fn();
      render(<Input id="test-input" ref={ref} />);
      expect(ref).toHaveBeenCalled();
      expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLInputElement);
    });
  });

  describe('ARIA required', () => {
    it('sets aria-required when required prop is true', () => {
      render(<Input id="test-input" required />);
      expect(screen.getByRole('textbox')).toHaveAttribute('aria-required', 'true');
    });

    it('uses native required validation when required prop is true', () => {
      render(<Input id="test-input" required />);
      expect(screen.getByRole('textbox')).toHaveAttribute('required');
    });
  });
});

describe('Textarea', () => {
  describe('Basic rendering', () => {
    it('renders textarea with id', () => {
      render(<Textarea id="test-textarea" />);
      expect(screen.getByRole('textbox')).toHaveAttribute('id', 'test-textarea');
    });

    it('renders label when provided', () => {
      render(<Textarea id="test-textarea" label="Test Label" />);
      expect(screen.getByLabelText('Test Label')).toBeInTheDocument();
    });

    it('applies correct base classes', () => {
      render(<Textarea id="test-textarea" />);
      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveClass('w-full');
      expect(textarea).toHaveClass('px-3');
      expect(textarea).toHaveClass('py-2');
      expect(textarea).toHaveClass('border');
      expect(textarea).toHaveClass('rounded-lg');
    });
  });

  describe('Value and onChange', () => {
    it('sets value prop', () => {
      render(<Textarea id="test-textarea" value="Test value" readOnly />);
      expect(screen.getByRole('textbox')).toHaveValue('Test value');
    });

    it('calls onChange when value changes', () => {
      const handleChange = vi.fn();
      render(<Textarea id="test-textarea" onChange={handleChange} />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New value' } });
      expect(handleChange).toHaveBeenCalled();
    });
  });

  describe('Error state', () => {
    it('shows error message when error prop provided', () => {
      render(<Textarea id="test-textarea" error="This field is required" />);
      expect(screen.getByRole('alert')).toHaveTextContent('This field is required');
    });

    it('applies error border class when error provided', () => {
      render(<Textarea id="test-textarea" error="Error" />);
      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveClass('border-red-500');
    });

    it('sets aria-invalid="true" when error provided', () => {
      render(<Textarea id="test-textarea" error="Error" />);
      expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    });

    it('does not reference a hidden hint when an error is present', () => {
      render(<Textarea id="test-textarea" error="Error" hint="Helper" />);
      expect(screen.getByRole('textbox')).toHaveAttribute('aria-describedby', 'test-textarea-error');
      expect(screen.queryByText('Helper')).not.toBeInTheDocument();
    });
  });

  describe('Rows', () => {
    it('sets rows attribute', () => {
      render(<Textarea id="test-textarea" rows={4} />);
      expect(screen.getByRole('textbox')).toHaveAttribute('rows', '4');
    });
  });

  describe('Disabled state', () => {
    it('disables textarea when disabled prop is true', () => {
      render(<Textarea id="test-textarea" disabled />);
      expect(screen.getByRole('textbox')).toBeDisabled();
    });
  });

  describe('Required', () => {
    it('uses native required validation when required prop is true', () => {
      render(<Textarea id="test-textarea" required />);
      expect(screen.getByRole('textbox')).toHaveAttribute('required');
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      render(<Textarea id="test-textarea" className="custom-textarea" />);
      expect(screen.getByRole('textbox')).toHaveClass('custom-textarea');
    });
  });

  describe('Forward ref', () => {
    it('forwards ref to underlying textarea', () => {
      const ref = vi.fn();
      render(<Textarea id="test-textarea" ref={ref} />);
      expect(ref).toHaveBeenCalled();
      expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLTextAreaElement);
    });
  });
});

describe('Select', () => {
  const options = [
    { value: 'option1', label: 'Option 1' },
    { value: 'option2', label: 'Option 2' },
    { value: 'option3', label: 'Option 3' },
  ];

  describe('Basic rendering', () => {
    it('renders select with id', () => {
      render(<Select id="test-select" options={options} />);
      expect(screen.getByRole('combobox')).toHaveAttribute('id', 'test-select');
    });

    it('renders label when provided', () => {
      render(<Select id="test-select" label="Test Label" options={options} />);
      expect(screen.getByLabelText('Test Label')).toBeInTheDocument();
    });

    it('renders options', () => {
      render(<Select id="test-select" options={options} />);
      options.forEach(opt => {
        expect(screen.getByRole('option', { name: opt.label })).toBeInTheDocument();
      });
    });

    it('applies correct base classes', () => {
      render(<Select id="test-select" options={options} />);
      const select = screen.getByRole('combobox');
      expect(select).toHaveClass('w-full');
      expect(select).toHaveClass('px-3');
      expect(select).toHaveClass('py-2');
      expect(select).toHaveClass('border');
      expect(select).toHaveClass('rounded-lg');
      expect(select).toHaveClass('bg-white');
    });
  });

  describe('Placeholder', () => {
    it('renders placeholder option when provided', () => {
      render(<Select id="test-select" options={options} placeholder="Select an option" />);
      expect(screen.getByRole('option', { name: 'Select an option' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Select an option' })).toHaveValue('');
    });
  });

  describe('Value and onChange', () => {
    it('sets value prop', () => {
      render(<Select id="test-select" options={options} value="option2" onChange={vi.fn()} />);
      expect(screen.getByRole('combobox')).toHaveValue('option2');
    });

    it('calls onChange when value changes', () => {
      const handleChange = vi.fn();
      render(<Select id="test-select" options={options} onChange={handleChange} />);
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'option2' } });
      expect(handleChange).toHaveBeenCalled();
    });
  });

  describe('Error state', () => {
    it('shows error message when error prop provided', () => {
      render(<Select id="test-select" options={options} error="This field is required" />);
      expect(screen.getByRole('alert')).toHaveTextContent('This field is required');
    });

    it('applies error border class when error provided', () => {
      render(<Select id="test-select" options={options} error="Error" />);
      const select = screen.getByRole('combobox');
      expect(select).toHaveClass('border-red-500');
    });

    it('sets aria-invalid="true" when error provided', () => {
      render(<Select id="test-select" options={options} error="Error" />);
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
    });

    it('does not reference a hidden hint when an error is present', () => {
      render(<Select id="test-select" options={options} error="Error" hint="Helper" />);
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-describedby', 'test-select-error');
      expect(screen.queryByText('Helper')).not.toBeInTheDocument();
    });
  });

  describe('Disabled state', () => {
    it('disables select when disabled prop is true', () => {
      render(<Select id="test-select" options={options} disabled />);
      expect(screen.getByRole('combobox')).toBeDisabled();
    });
  });

  describe('Required', () => {
    it('renders required indicator when required', () => {
      render(<Select id="test-select" label="Test select" options={options} required />);
      expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('sets aria-required when required', () => {
      render(<Select id="test-select" options={options} required />);
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-required', 'true');
    });

    it('uses native required validation when required prop is true', () => {
      render(<Select id="test-select" options={options} required />);
      expect(screen.getByRole('combobox')).toHaveAttribute('required');
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      render(<Select id="test-select" options={options} className="custom-select" />);
      expect(screen.getByRole('combobox')).toHaveClass('custom-select');
    });
  });

  describe('Forward ref', () => {
    it('forwards ref to underlying select', () => {
      const ref = vi.fn();
      render(<Select id="test-select" options={options} ref={ref} />);
      expect(ref).toHaveBeenCalled();
      expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLSelectElement);
    });
  });
});