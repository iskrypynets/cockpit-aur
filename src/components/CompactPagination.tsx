import React from "react";
import { Pagination, PaginationProps } from "@patternfly/react-core";
import { PER_PAGE_OPTIONS } from "../constants";

type CompactPaginationProps = Pick<
  PaginationProps,
  "itemCount" | "page" | "perPage" | "onSetPage" | "onPerPageSelect" | "perPageOptions" | "variant"
>;

/** Pagination with the shared per-page options and compact styling. */
export const CompactPagination: React.FC<CompactPaginationProps> = (props) => (
  <Pagination
    perPageOptions={PER_PAGE_OPTIONS}
    isCompact
    style={{
      // Force page menu and navigation controls to display on narrow/mobile viewports
      ["--pf-v6-c-pagination__page-menu--Display" as string]: "inline-block",
      ["--pf-v6-c-pagination__nav--Display" as string]: "inline-flex",
      flexWrap: "nowrap",
    }}
    {...props}
  />
);
