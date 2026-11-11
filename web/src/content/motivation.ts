// Edit this list freely. One pair is shown per day, rotating by date.
export interface Motivation { headline: string; line: string }

export const MOTIVATION: Motivation[] = [
  { headline: "You've got this.", line: "Ten emails. That's all today asks for." },
  { headline: 'Just start.', line: 'The first email is the hardest one. It gets easier after that.' },
  { headline: 'Send it anyway.', line: "Nobody replies to the email you didn't send." },
  { headline: 'Small and steady.', line: 'A few people a day adds up faster than you think.' },
  { headline: 'One company today.', line: 'Add one, queue it, close the tab.' },
  { headline: 'Done beats perfect.', line: 'Your line is good enough. Let it go out.' },
  { headline: 'Keep the streak.', line: "Show up today. That's the whole job." },
  { headline: "Someone's reading.", line: 'Every reply so far started with an email like this one.' },
];

/** Same pair all day, a new one tomorrow. `today` is an IST 'yyyy-MM-dd' string. */
export const motivationFor = (today: string): Motivation => {
  const days = Math.floor(new Date(today + 'T00:00:00Z').getTime() / 86400000);
  return MOTIVATION[((days % MOTIVATION.length) + MOTIVATION.length) % MOTIVATION.length];
};
