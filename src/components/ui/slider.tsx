import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex w-full touch-none select-none items-center py-1.5", className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-[7px] w-full grow overflow-hidden rounded-full bg-secondary/60">
      <SliderPrimitive.Range className="absolute h-full bg-primary will-change-transform" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-[22px] w-[22px] rounded-full border-[2.5px] border-primary bg-background shadow-[0_1px_6px_hsl(var(--primary)/0.25)] will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-110 active:shadow-[0_0_12px_hsl(var(--primary)/0.4)] transition-[transform,box-shadow] duration-100" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
