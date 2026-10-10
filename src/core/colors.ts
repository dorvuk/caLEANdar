export function mixColor(hex: string, base: string, amount: number): string {
  const channel = (color: string, i: number) => parseInt(color.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map(i => Math.round(channel(hex, i) * amount + channel(base, i) * (1 - amount)).toString(16).padStart(2, '0')).join('')}`;
}
export function courseColors(color: string, dark: boolean) {
  return { border: mixColor(color, dark ? '#ffffff' : '#000000', dark ? .65 : .8), background: mixColor(color, dark ? '#1c251f' : '#fafbf7', dark ? .25 : .14) };
}
