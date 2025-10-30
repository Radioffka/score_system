// services/homeAssistantService.ts
import { getAuth } from 'home-assistant-js-websocket';
import { Hass, Reward, Reason, HistoryEntry, HassEntity } from '../types.ts';
import { SUFFIX } from '../utils/constants.ts';

// --- TYPES ---
export interface IApplicationData {
    points: number;
    rewards: Reward[];
    reasons: Reason[];
    history: HistoryEntry[];
    appName: string;
    profilePicture: string;
    entityPrefix: string;
}

// --- MODULE STATE ---
let hassPromise: Promise<Hass> | null = null;

// --- CORE CONNECTION ---
function getHassConnection(): Promise<Hass> {
    if (hassPromise) {
        return hassPromise;
    }

    hassPromise = new Promise(async (resolve, reject) => {
        const maxTries = 20; // 5 seconds total
        let attempt = 0;

        const tryConnect = async () => {
            try {
                const auth = await getAuth({ hassUrl: window.location.origin });
                // FIX: `subscribeStates` was removed in `home-assistant-js-websocket` v8. Replaced with `subscribeEntities`.
                const { createConnection, getStates, callService, subscribeEntities } = await import('home-assistant-js-websocket');
                const connection = await createConnection({ auth });

                const statesArray = await getStates(connection);
                const states = statesArray.reduce((acc, entity) => {
                    acc[entity.entity_id] = entity;
                    return acc;
                }, {} as { [entity_id: string]: HassEntity });


                const hassObject: Hass = {
                    callService: (domain, service, serviceData) =>
                        callService(connection, domain, service, serviceData),
                    states: states,
                };
                
                subscribeEntities(connection, updatedStates => {
                    hassObject.states = updatedStates;
                });

                resolve(hassObject);
            } catch (err) {
                attempt++;
                if (attempt < maxTries) {
                    setTimeout(tryConnect, 250);
                } else {
                    console.error("Failed to get Home Assistant auth after multiple attempts.", err);
                    reject(new Error('Could not get Home Assistant authorization. Make sure you are running this in a Home Assistant iFrame.'));
                }
            }
        };

        tryConnect();
    });

    return hassPromise;
}


// --- ENTITY MANAGEMENT ---
const ENTITY_CONFIG_SUFFIX = 'config_prefix';

async function createEntity(hass: Hass, domain: 'input_number' | 'input_text', entity_id: string, name: string, extra_params: object = {}): Promise<void> {
     try {
        await hass.callService(domain, 'create', {
            object_id: entity_id,
            name: `Bodík ${name}`,
            ...extra_params,
        });
        console.log(`Successfully created entity: ${domain}.${entity_id}`);
    } catch (e: any) {
        if (e && e.code === 'duplicate_object_id') {
             console.log(`Entity ${domain}.${entity_id} already exists.`);
        } else {
            console.error(`Failed to create entity ${domain}.${entity_id}:`, e);
            throw new Error(`Failed to create entity ${domain}.${entity_id}`);
        }
    }
}

async function initializeEntities(prefix: string): Promise<void> {
    const hass = await getHassConnection();
    const p = (suffix: string) => `${prefix}_${suffix}`;

    // Create all necessary base entities
    await createEntity(hass, 'input_number', p(SUFFIX.POINTS), 'Points', { min: -1000, max: 10000, step: 1, mode: 'box' });
    await createEntity(hass, 'input_text', `${p(SUFFIX.REWARDS)}_0`, 'Rewards Chunk 0');
    await createEntity(hass, 'input_text', `${p(SUFFIX.REASONS)}_0`, 'Reasons Chunk 0');
    await createEntity(hass, 'input_text', `${p(SUFFIX.HISTORY)}_0`, 'History Chunk 0');
    await createEntity(hass, 'input_text', p(SUFFIX.APP_NAME), 'App Name');
    await createEntity(hass, 'input_text', p(SUFFIX.PROFILE_PICTURE), 'Profile Picture');

    // Set initial values
    await updateState(prefix, 'points', 0);
    await updateState(prefix, 'rewards', []);
    await updateState(prefix, 'reasons', []);
    await updateState(prefix, 'history', []);
    await updateState(prefix, 'appName', 'Bodík');
    await updateState(prefix, 'profilePicture', '');
}

// --- CHUNKED STATE LOGIC ---
const CHUNK_SIZE = 250; 

async function readChunkedState<T>(prefix: string, keySuffix: string, defaultValue: T): Promise<T> {
    const hass = await getHassConnection();
    const chunks: string[] = [];
    let i = 0;
    
    while (true) {
        const entityId = `input_text.${prefix}_${keySuffix}_${i}`;
        const entity = hass.states[entityId];
        
        if (!entity || entity.state === 'unknown' || entity.state === 'unavailable' || entity.state === '') {
            break; 
        }
        chunks.push(entity.state);
        i++;
    }

    if (chunks.length === 0) {
        return defaultValue;
    }

    try {
        return JSON.parse(chunks.join(''));
    } catch (e) {
        console.error(`Error parsing chunked state for ${prefix}_${keySuffix}`, e);
        return defaultValue;
    }
}


async function updateChunkedState(prefix: string, keySuffix: string, value: any): Promise<void> {
    const hass = await getHassConnection();
    const jsonString = JSON.stringify(value);
    const numChunks = Math.ceil(jsonString.length / CHUNK_SIZE) || 1;

    for (let i = 0; i < numChunks; i++) {
        const chunk = jsonString.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) || '';
        const entityId = `${prefix}_${keySuffix}_${i}`;

        await createEntity(hass, 'input_text', entityId, `${keySuffix} Chunk ${i}`);

        await hass.callService('input_text', 'set_value', {
            entity_id: `input_text.${entityId}`,
            value: chunk
        });
    }

    // Clear any leftover chunks from previous writes to avoid stale data being re-read.
    let clearIndex = numChunks;
    while (true) {
        const entityId = `input_text.${prefix}_${keySuffix}_${clearIndex}`;
        const entity = hass.states[entityId];
        if (!entity) {
            break;
        }

        await hass.callService('input_text', 'set_value', {
            entity_id: entityId,
            value: ''
        });

        clearIndex++;
    }
}


// --- PUBLIC API ---

export async function initialize(providedPrefix?: string): Promise<{ isInitialized: boolean, prefix: string | null }> {
    const hass = await getHassConnection();
    
    if (providedPrefix) {
        const configEntity = `input_text.${ENTITY_CONFIG_SUFFIX}`;
        await createEntity(hass, 'input_text', ENTITY_CONFIG_SUFFIX, 'App Config Prefix');
        await hass.callService('input_text', 'set_value', { entity_id: configEntity, value: providedPrefix });
        await initializeEntities(providedPrefix);
        return { isInitialized: true, prefix: providedPrefix };
    }

    const configEntityId = `input_text.${ENTITY_CONFIG_SUFFIX}`;
    // We need to check if the entity exists first
    await createEntity(hass, 'input_text', ENTITY_CONFIG_SUFFIX, 'App Config Prefix');
    const prefixEntity = hass.states[configEntityId];
    
    if (prefixEntity && prefixEntity.state && prefixEntity.state !== 'unknown' && prefixEntity.state !== '') {
        return { isInitialized: true, prefix: prefixEntity.state };
    }
    
    return { isInitialized: false, prefix: null };
}

export async function loadApplicationState(prefix: string): Promise<IApplicationData> {
    const hass = await getHassConnection();
    const p = (suffix: string) => `${prefix}_${suffix}`;

    const pointsEntity = hass.states[`input_number.${p(SUFFIX.POINTS)}`];

    const data: IApplicationData = {
        points: pointsEntity ? Number(pointsEntity.state) : 0,
        rewards: await readChunkedState(prefix, SUFFIX.REWARDS, []),
        reasons: await readChunkedState(prefix, SUFFIX.REASONS, []),
        history: await readChunkedState(prefix, SUFFIX.HISTORY, []),
        appName: hass.states[`input_text.${p(SUFFIX.APP_NAME)}`]?.state || 'Bodík',
        profilePicture: hass.states[`input_text.${p(SUFFIX.PROFILE_PICTURE)}`]?.state || '',
        entityPrefix: prefix,
    };
    return data;
}

export async function updateState<K extends keyof IApplicationData>(
    prefix: string,
    key: K,
    value: K extends 'entityPrefix' ? IApplicationData[K] | null : IApplicationData[K]
): Promise<void> {
    const hass = await getHassConnection();
    const p = (suffix: string) => `${prefix}_${suffix}`;
    
    switch (key) {
        case 'points':
            await hass.callService('input_number', 'set_value', { entity_id: `input_number.${p(SUFFIX.POINTS)}`, value: value });
            break;
        case 'rewards':
            await updateChunkedState(prefix, SUFFIX.REWARDS, value);
            break;
        case 'reasons':
            await updateChunkedState(prefix, SUFFIX.REASONS, value);
            break;
        case 'history':
            await updateChunkedState(prefix, SUFFIX.HISTORY, value);
            break;
        case 'appName':
            await hass.callService('input_text', 'set_value', { entity_id: `input_text.${p(SUFFIX.APP_NAME)}`, value: value });
            break;
        case 'profilePicture':
            await hass.callService('input_text', 'set_value', { entity_id: `input_text.${p(SUFFIX.PROFILE_PICTURE)}`, value: value });
            break;
        case 'entityPrefix': 
             if (value === null) {
                await hass.callService('input_text', 'set_value', { entity_id: `input_text.${ENTITY_CONFIG_SUFFIX}`, value: '' });
             }
            break;
    }
}