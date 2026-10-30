import type { ComponentProps, ReactNode } from "react";
import Form from "next/form";
import { FilterContent } from "./loading/filter-content";

import { cn } from "@/lib/utils";

type FilterBarProps = Omit<ComponentProps<typeof Form>, "action"> & {
  action?: string;
  actions: ReactNode;
  columns?: 3 | 4;
  title?: string;
};

export const filterSelectClass = "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25";

export function FilterBar({ children, actions, action = "", columns = 3, title = "Filter pencarian", className, ...props }: FilterBarProps) {
  return (
    <Form action={action} scroll={false} aria-label={title} {...props} data-filter-bar data-print-hide className={cn("filter-bar w-full min-w-0 overflow-hidden rounded-xl border bg-card shadow-xs", className)}>
      <FilterContent actions={actions} columns={columns} title={title}>{children}</FilterContent>
    </Form>
  );
}
