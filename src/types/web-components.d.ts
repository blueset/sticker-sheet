declare namespace JSX {
  interface IntrinsicElements {
    // baseline-status: https://github.com/web-platform-dx/baseline-status
    "baseline-status": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        featureId: string;
      },
      HTMLElement
    >;

    // caniuse-embed-element: https://github.com/stefanjudis/caniuse-embed-element
    "caniuse-embed": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        feature: string;
        periods?: string;
        "show-accessible-colors"?: boolean;
      },
      HTMLElement
    >;
  }
}

declare module "baseline-status";
