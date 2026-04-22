import React from "react";

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  leftIcon?: React.ReactNode;
  rightAdornment?: React.ReactNode;
  wrapperClassName?: string;
  inputClassName?: string;
};

const BASE_INPUT_CLASS =
  "h-12 w-full rounded-[14px] border border-[#E2E8F0] bg-[rgba(255,255,255,0.90)] text-[15px] text-[#0f172a] shadow-sm outline-none transition duration-200 placeholder:text-[#94A3B8] hover:border-[#CBD5E1] focus:border-[#2563EB] focus:shadow-[0_0_0_4px_rgba(37,99,235,0.15)]";

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      leftIcon,
      rightAdornment,
      wrapperClassName = "",
      inputClassName = "",
      className,
      id,
      ...props
    },
    ref
  ) => {
    const finalClassName = [BASE_INPUT_CLASS, className, inputClassName].filter(Boolean).join(" ");

    return (
      <label htmlFor={id} className={["block text-sm text-[#334155]", wrapperClassName].filter(Boolean).join(" ")}>
        {label ? <span className="mb-1.5 block font-medium">{label}</span> : null}
        <div className="relative">
          {leftIcon ? (
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[#94A3B8]">
              {leftIcon}
            </span>
          ) : null}
          <input
            ref={ref}
            id={id}
            className={`${finalClassName} ${leftIcon ? "pl-10" : "pl-3.5"} ${rightAdornment ? "pr-11" : "pr-3.5"}`}
            {...props}
          />
          {rightAdornment ? (
            <span className="absolute inset-y-0 right-0 flex items-center pr-1.5">{rightAdornment}</span>
          ) : null}
        </div>
      </label>
    );
  }
);

Input.displayName = "Input";

