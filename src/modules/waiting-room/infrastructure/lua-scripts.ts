export const JOIN_QUEUE_SCRIPT = `
local queueKey = KEYS[1]
local heartbeatKey = KEYS[2]
local admittedKey = KEYS[3]
local userId = ARGV[1]
local nowMs = tonumber(ARGV[2])
local heartbeatTtl = tonumber(ARGV[3])

local admittedToken = redis.call('GET', admittedKey)
if admittedToken then
  return cjson.encode({ status = 'ADMITTED', admissionToken = admittedToken })
end

local rank = redis.call('ZRANK', queueKey, userId)
if not rank then
  redis.call('ZADD', queueKey, nowMs, userId)
  rank = redis.call('ZRANK', queueKey, userId)
end

redis.call('SET', heartbeatKey, '1', 'EX', heartbeatTtl)

local total = redis.call('ZCARD', queueKey)
return cjson.encode({
  status = 'QUEUED',
  rank = rank + 1,
  totalInQueue = total
})
`;

export const CHECK_STATUS_SCRIPT = `
local queueKey = KEYS[1]
local heartbeatKey = KEYS[2]
local admittedKey = KEYS[3]
local userId = ARGV[1]

local admittedToken = redis.call('GET', admittedKey)
if admittedToken then
  local ttl = redis.call('TTL', admittedKey)
  return cjson.encode({ status = 'ADMITTED', admissionToken = admittedToken, expiresIn = ttl })
end

local rank = redis.call('ZRANK', queueKey, userId)
if not rank then
  return cjson.encode({ status = 'NOT_IN_QUEUE' })
end

local hasHeartbeat = redis.call('EXISTS', heartbeatKey)
if hasHeartbeat == 0 then
  redis.call('ZREM', queueKey, userId)
  return cjson.encode({ status = 'EXPIRED' })
end

local total = redis.call('ZCARD', queueKey)
return cjson.encode({
  status = 'QUEUED',
  rank = rank + 1,
  totalInQueue = total
})
`;

export const HEARTBEAT_SCRIPT = `
local queueKey = KEYS[1]
local heartbeatKey = KEYS[2]
local admittedKey = KEYS[3]
local userId = ARGV[1]
local heartbeatTtl = tonumber(ARGV[2])

local isAdmitted = redis.call('EXISTS', admittedKey)
local inQueue = redis.call('ZRANK', queueKey, userId)

if isAdmitted == 1 or inQueue then
  redis.call('SET', heartbeatKey, '1', 'EX', heartbeatTtl)
  return 1
end

return 0
`;

export const ADMIT_BATCH_SCRIPT = `
local queueKey = KEYS[1]
local eventId = ARGV[1]
local batchSize = tonumber(ARGV[2])

local members = redis.call('ZRANGE', queueKey, 0, batchSize - 1)
local admittedUsers = {}

for _, userId in ipairs(members) do
  local heartbeatKey = 'queue:heartbeat:event:' .. eventId .. ':' .. userId
  local hasHeartbeat = redis.call('EXISTS', heartbeatKey)
  redis.call('ZREM', queueKey, userId)
  if hasHeartbeat == 1 then
    table.insert(admittedUsers, userId)
  end
end

return cjson.encode(admittedUsers)
`;
