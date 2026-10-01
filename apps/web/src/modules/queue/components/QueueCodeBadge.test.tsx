import React from "react";
import { create } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { QueueCodeBadge } from "./QueueCodeBadge";

describe("QueueCodeBadge", () => {
  it("renders the ticket code as one pill", () => {
    const tree = create(<QueueCodeBadge code="К-05" />).toJSON();
    expect(tree).toMatchObject({ type: "span", children: ["К-05"] });
  });

  it("renders nothing when the appointment has no queue code", () => {
    expect(create(<QueueCodeBadge code={null} />).toJSON()).toBeNull();
    expect(create(<QueueCodeBadge code={undefined} />).toJSON()).toBeNull();
    expect(create(<QueueCodeBadge code="  " />).toJSON()).toBeNull();
  });
});
