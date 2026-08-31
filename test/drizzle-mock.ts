export function queryReturning<T>(result: T) {
  const promise = Promise.resolve(result);
  const query = {
    from: jest.fn(),
    groupBy: jest.fn(),
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    limit: jest.fn(),
    onConflictDoNothing: jest.fn(),
    onConflictDoUpdate: jest.fn(),
    orderBy: jest.fn(),
    returning: jest.fn(),
    set: jest.fn(),
    then: promise.then.bind(promise),
    values: jest.fn(),
    where: jest.fn(),
  };

  for (const method of [
    query.from,
    query.groupBy,
    query.innerJoin,
    query.leftJoin,
    query.limit,
    query.onConflictDoNothing,
    query.onConflictDoUpdate,
    query.orderBy,
    query.returning,
    query.set,
    query.values,
    query.where,
  ]) {
    method.mockReturnValue(query);
  }

  return query;
}
