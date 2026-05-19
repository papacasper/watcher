declare module "*.css" {
  const text: string;
  export default text;
}

declare module "../dist/bundle.js" {
  const text: string;
  export default text;
}
