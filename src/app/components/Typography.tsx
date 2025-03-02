import { cn } from "@/lib/utils";
import Link from "next/link";
import React from "react";

function makeTypographyComponent(
  tag: string | React.ElementType,
  className: string,
  defaultProps: React.HTMLAttributes<HTMLHeadingElement> = {}
) {
  function Typography({
    children,
    className: inputClassName,
    ...props
  }: { children: React.ReactNode } & React.HTMLAttributes<HTMLHeadingElement>) {
    return React.createElement(
      tag,
      { className: cn(className, inputClassName), ...defaultProps, ...props },
      children
    );
  }

  Typography.displayName = `Typography.${tag}`;

  return Typography;
}

export const H1 = makeTypographyComponent(
  "h1",
  "scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl"
);
export const H2 = makeTypographyComponent(
  "h2",
  "scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0"
);
export const H3 = makeTypographyComponent(
  "h3",
  "scroll-m-20 text-2xl font-semibold tracking-tight"
);
export const H4 = makeTypographyComponent(
  "h4",
  "scroll-m-20 text-xl font-semibold tracking-tight"
);
export const P = makeTypographyComponent(
  "p",
  "leading-7 [&:not(:first-child)]:mt-6"
);
export const Blockquote = makeTypographyComponent(
  "blockquote",
  "mt-6 border-l-2 pl-6"
);
export const Ul = makeTypographyComponent(
  "ul",
  "my-6 ml-6 list-disc [&>li]:mt-2"
);
export const Code = makeTypographyComponent(
  "code",
  "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold before:content-[''] after:content-['']"
);
export const Pre = makeTypographyComponent(
  "pre",
  "my-6 overflow-x-auto rounded-lg border bg-background p-4 [&>code]:bg-transparent [&>code]:p-0"
);
export const Lead = makeTypographyComponent(
  "div",
  "text-xl text-muted-foreground"
);
export const Large = makeTypographyComponent("div", "text-xl font-semibold");
export const Abbr = makeTypographyComponent(
  "abbr",
  "title:decoration-skip-ink title:decoration-dotted no-hover:title:after:content-['_('_attr(title)_')'] no-hover:title:after:text-xs no-hover:title:after:text-muted-foreground no-hover:title:no-underline",
  { tabIndex: 0 }
);
export const Small = makeTypographyComponent(
  "div",
  "text-sm font-medium leading-none"
);
export const Muted = makeTypographyComponent(
  "div",
  "text-sm text-muted-foreground"
);

export function A({
  children,
  className,
  href,
  ...props
}: { children: React.ReactNode } & React.ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        "font-medium text-primary underline underline-offset-4 no-hover:title:after:content-['_('_attr(title)_')'] no-hover:title:after:text-xs no-hover:title:after:text-muted-foreground",
        className
      )}
      href={href}
      target={href.toString().startsWith("http") ? "_blank" : undefined}
      {...props}
    >
      {children}
    </Link>
  );
}
