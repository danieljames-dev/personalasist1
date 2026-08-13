const n = Number(process.argv[2] || 2000);
const line = `${"x".repeat(80)}\n`;
for (let i = 0; i < n; i += 1) process.stdout.write(line);
