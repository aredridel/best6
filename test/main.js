/* eslint-disable camelcase */

import {strict  as assert } from 'assert';

import testLib from '../lib/test-lib.js';

const sleep = async ms => new Promise(res => setTimeout(res, ms));

export const sleep10 = async () => sleep(10);
export const sleep100 = async () => sleep(100);
export const sleep200 = async () => sleep(200);
export const sleep400 = async () => sleep(400);

export const testLib1 = () => assert.equal(testLib(10, 15), 25);
export const testLib2 = () => assert.equal(testLib(20, 4), 24);
