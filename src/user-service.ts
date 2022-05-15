const findById = (userId) => users.find((u) => u.id === userId);

export default findById;

const users = [
  {
    id: "1001",
    name: "admin",
  },
];
