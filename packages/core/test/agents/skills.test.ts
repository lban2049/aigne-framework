import { expect, test } from "bun:test";
import { Agent, FunctionAgent } from "@aigne/core";

test("Agent.skills", async () => {
  const greeting = FunctionAgent.from({
    name: "greeting",
    fn: ({ name }: { name: string }) => ({
      greeting: `Hello, ${name}!`,
    }),
  });

  const bye = FunctionAgent.from({
    name: "bye",
    fn: ({ name }: { name: string }) => ({
      greeting: `Bye, ${name}!`,
    }),
  });

  const agent = Agent.from({
    skills: [greeting, bye],
  });

  expect(await agent.skills.greeting?.call({ name: "Alice" })).toEqual({
    greeting: "Hello, Alice!",
  });

  expect(await agent.skills.bye?.call({ name: "Alice" })).toEqual({
    greeting: "Bye, Alice!",
  });

  expect(agent.skills.undefined).toBeUndefined();

  agent.addSkill(function echo(input: { name: string }) {
    return input;
  });

  expect(agent.skills.length).toBe(3);

  expect(await agent.skills.echo?.call({ name: "Alice" })).toEqual({
    name: "Alice",
  });
});
