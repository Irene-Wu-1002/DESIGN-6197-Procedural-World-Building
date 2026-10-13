/** Binary min-heap of integer ids ordered by a numeric priority. */
export class MinHeap {
  constructor() {
    this.ids = []
    this.priorities = []
  }

  get size() {
    return this.ids.length
  }

  push(id, priority) {
    const { ids, priorities } = this
    let index = ids.length
    ids.push(id)
    priorities.push(priority)
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (priorities[parent] <= priority) break
      ids[index] = ids[parent]
      priorities[index] = priorities[parent]
      index = parent
    }
    ids[index] = id
    priorities[index] = priority
  }

  pop() {
    const { ids, priorities } = this
    const top = ids[0]
    const lastId = ids.pop()
    const lastPriority = priorities.pop()
    if (ids.length > 0) {
      let index = 0
      const length = ids.length
      while (true) {
        const left = index * 2 + 1
        if (left >= length) break
        const right = left + 1
        const child = right < length && priorities[right] < priorities[left] ? right : left
        if (priorities[child] >= lastPriority) break
        ids[index] = ids[child]
        priorities[index] = priorities[child]
        index = child
      }
      ids[index] = lastId
      priorities[index] = lastPriority
    }
    return top
  }
}
