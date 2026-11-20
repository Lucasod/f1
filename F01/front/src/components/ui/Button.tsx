import { ButtonHTMLAttributes, forwardRef, ComponentPropsWithoutRef, ReactElement, isValidElement, cloneElement } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  onClick?: React.MouseEventHandler<HTMLElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  loadingText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  asChild?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
  secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-500',
  ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 focus:ring-gray-500',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  outline: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-blue-500',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      loadingText = 'Loading...',
      leftIcon,
      rightIcon,
      fullWidth = false,
      asChild = false,
      disabled,
      onClick: buttonOnClick,
      className = '',
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading;

    const baseClasses = `
      inline-flex items-center justify-center font-medium rounded-lg
      transition-colors duration-150 ease-in-out
      focus:outline-none focus:ring-2 focus:ring-offset-2
      disabled:opacity-50 disabled:cursor-not-allowed
      ${variantClasses[variant]}
      ${sizeClasses[size]}
      ${fullWidth ? 'w-full' : ''}
      ${className}
    `;

    const loadingContent = (
      <>
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        <span>{loadingText}</span>
      </>
    );

    const buttonContent = isLoading ? loadingContent : (
      <>
        {leftIcon && <span className="mr-2" aria-hidden="true">{leftIcon}</span>}
        {children}
        {rightIcon && <span className="ml-2" aria-hidden="true">{rightIcon}</span>}
      </>
    );

if (asChild) {
        // Render as the child component (e.g., Link) with button styles
        if (!isValidElement(children)) {
          // If children is not a valid element, render as button
          return (
            <button
              ref={ref}
              type="button"
              disabled={isDisabled}
              className={baseClasses}
              onClick={buttonOnClick}
              {...props}
            >
              {buttonContent}
            </button>
          );
        }

        const child = children as ReactElement<ComponentPropsWithoutRef<'a'>>;
        const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
          if (isDisabled) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (child.props.onClick) {
            child.props.onClick(e);
          }
          if (!e.defaultPrevented) {
            buttonOnClick?.(e);
          }
        };
        return cloneElement(children, {
          ...props,
          ...child.props,
          className: `${baseClasses} ${child.props.className || ''}`,
          'aria-disabled': isDisabled,
          tabIndex: isDisabled ? -1 : child.props.tabIndex,
          onClick: handleClick,
        });
      }

    return (
      <button
        ref={ref}
        type="button"
        disabled={isDisabled}
        className={baseClasses}
        onClick={buttonOnClick}
        {...props}
      >
        {buttonContent}
      </button>
    );
  }
);

Button.displayName = 'Button';

export { Button };
export type { ButtonProps };