export function createRequestCache() {
  const requests = new Map();
  return {
    get(key, load) {
      if (requests.has(key)) return requests.get(key);
      const request = Promise.resolve().then(load).catch(error => {
        requests.delete(key);
        throw error;
      });
      requests.set(key, request);
      return request;
    },
  };
}
