async function test() {
  try {
    const mod = await import('get-windows');
    console.log(mod);
  } catch (err) {
    console.error(err);
  }
}

test();
