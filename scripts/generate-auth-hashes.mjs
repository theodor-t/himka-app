import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { stdin as input, stdout as output } from "node:process";

const createPasswordHash = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
};

const askSecret = (prompt) =>
  new Promise((resolve) => {
    output.write(prompt);
    let value = "";
    input.setRawMode?.(true);
    input.resume();
    const onData = (chunk) => {
      const character = chunk.toString();
      if (character === "\u0003") process.exit(1);
      if (character === "\r" || character === "\n") {
        input.setRawMode?.(false);
        input.removeListener("data", onData);
        output.write("\n");
        resolve(value);
      } else if (character === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += character;
      }
    };
    input.on("data", onData);
  });

const tudor = await askSecret("New TUDOR password: ");
const dan = await askSecret("New DAN password: ");
  const sessionSecret = randomUUID() + randomUUID();
  console.log(`AUTH_TUDOR_PASSWORD_HASH=${createPasswordHash(tudor)}`);
  console.log(`AUTH_DAN_PASSWORD_HASH=${createPasswordHash(dan)}`);
  console.log(`AUTH_SESSION_SECRET=${sessionSecret}`);
