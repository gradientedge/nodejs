import forEach from 'lodash.foreach'
import flatten from 'lodash.flatten'
import { deepEqual } from 'fast-equals'
import createBuildArrayActions, {
  ADD_ACTIONS,
  REMOVE_ACTIONS,
  CHANGE_ACTIONS,
} from './utils/create-build-array-actions'
import { buildBaseAttributesActions } from './utils/common-actions'
import * as diffpatcher from './utils/diffpatcher'
import extractMatchingPairs from './utils/extract-matching-pairs'

const REGEX_NUMBER = new RegExp(/^\d+$/)
const REGEX_UNDERSCORE_NUMBER = new RegExp(/^_\d+$/)
const getIsChangedOperation = key => REGEX_NUMBER.test(key)
const getIsRemovedOperation = key => REGEX_UNDERSCORE_NUMBER.test(key)

export const baseActionsList = [
  { action: 'changeName', key: 'name' },
  { action: 'setKey', key: 'key' },
  { action: 'changeDescription', key: 'description' },
]

export function actionsMapBase(diff, previous, next, config = {}) {
  return buildBaseAttributesActions({
    diff,
    actions: baseActionsList,
    oldObj: previous,
    newObj: next,
    shouldOmitEmptyString: config.shouldOmitEmptyString,
  })
}

const attributeDefinitionsActionsList = [
  { action: 'changeLabel', key: 'label' },
  { action: 'setInputTip', key: 'inputTip' },
  { actionKey: 'newValue', action: 'changeInputHint', key: 'inputHint' },
  { action: 'changeIsSearchable', key: 'isSearchable' },
  {
    actionKey: 'newValue',
    action: 'changeAttributeConstraint',
    key: 'attributeConstraint',
  },
]

const getIsAnAttributeDefinitionBaseFieldChange = diff =>
  diff.label ||
  diff.inputHint ||
  diff.inputTip ||
  diff.attributeConstraint ||
  diff.isSearchable

function actionsMapEnums(attributeType, attributeDiff, previous, next) {
  const addEnumActionName =
    attributeType === 'enum' ? 'addPlainEnumValue' : 'addLocalizedEnumValue'
  const changeEnumOrderActionName =
    attributeType === 'enum'
      ? 'changePlainEnumValueOrder'
      : 'changeLocalizedEnumValueOrder'
  const changeEnumLabelActionName =
    attributeType === 'enum'
      ? 'changePlainEnumValueLabel'
      : 'changeLocalizedEnumValueLabel'
  const buildArrayActions = createBuildArrayActions('values', {
    [ADD_ACTIONS]: newEnum => ({
      attributeName: next.name,
      action: addEnumActionName,
      value: newEnum,
    }),
    [CHANGE_ACTIONS]: (oldEnum, newEnum) => {
      const oldEnumInNext = next.values.find(
        nextEnum => nextEnum.key === oldEnum.key
      )

      // These `changeActions` would impose a nested structure among
      // the accumulated `updateActions` generated by `buildArrayActions`
      // In the end; we have to flatten the structure before we pass it back
      // to the client.
      const changeActions = []
      if (oldEnumInNext) {
        if (!deepEqual(oldEnum.label, oldEnumInNext.label)) {
          changeActions.push({
            attributeName: next.name,
            action: changeEnumLabelActionName,
            newValue: newEnum,
          })
        } else {
          changeActions.push({
            attributeName: next.name,
            action: changeEnumOrderActionName,
            value: newEnum,
          })
        }
      } else {
        changeActions.push({
          attributeName: next.name,
          action: 'removeEnumValue',
          value: oldEnum,
        })
        changeActions.push({
          attributeName: next.name,
          action: addEnumActionName,
          value: newEnum,
        })
      }
      return changeActions
    },
    [REMOVE_ACTIONS]: deletedEnum => ({
      attributeName: next.name,
      action: 'removeEnumValue',
      value: deletedEnum,
    }),
  })

  const actions = []
  // following lists are necessary to ensure that when we remove or change the
  // order of enumValues, we generate one updateAction instead of one at a time.
  const removedKeys = []
  const newEnumValuesOrder = []

  flatten(buildArrayActions(attributeDiff, previous, next)).forEach(
    updateAction => {
      if (updateAction.action === 'removeEnumValue')
        removedKeys.push(updateAction.value.key)
      else if (updateAction.action === changeEnumOrderActionName) {
        newEnumValuesOrder.push(updateAction.value)
      } else actions.push(updateAction)
    }
  )

  return [
    ...actions,
    ...(newEnumValuesOrder.length > 0
      ? [
          {
            attributeName: next.name,
            action: changeEnumOrderActionName,
            values: newEnumValuesOrder,
          },
        ]
      : []),
    ...(removedKeys.length > 0
      ? [
          {
            attributeName: next.name,
            action: 'removeEnumValues',
            keys: removedKeys,
          },
        ]
      : []),
  ]
}

export function actionsMapAttributes(
  attributesDiff,
  previous,
  next,
  diffPaths
) {
  const actions = []
  forEach(attributesDiff, (diffValue, diffKey) => {
    const extractedPairs = extractMatchingPairs(
      diffPaths,
      diffKey,
      previous,
      next
    )

    if (getIsChangedOperation(diffKey)) {
      if (Array.isArray(diffValue)) {
        const deltaValue = diffpatcher.getDeltaValue(diffValue)
        if (deltaValue.name) {
          actions.push({
            action: 'addAttributeDefinition',
            attribute: deltaValue,
          })
        }
      } else if (getIsAnAttributeDefinitionBaseFieldChange(diffValue)) {
        actions.push(
          ...buildBaseAttributesActions({
            actions: attributeDefinitionsActionsList,
            diff: diffValue,
            oldObj: extractedPairs.oldObj,
            newObj: extractedPairs.newObj,
          }).map(action => ({
            ...action,
            attributeName: extractedPairs.oldObj.name,
          }))
        )
      } else if (diffValue.type.values) {
        actions.push(
          ...actionsMapEnums(
            extractedPairs.oldObj.type.name,
            diffValue.type,
            extractedPairs.oldObj.type,
            extractedPairs.newObj.type
          )
        )
      }
    } else if (getIsRemovedOperation(diffKey)) {
      if (Array.isArray(diffValue)) {
        if (diffValue.length === 3 && diffValue[2] === 3) {
          actions.push({
            action: 'changeAttributeOrder',
            attributes: next,
          })
        } else {
          const deltaValue = diffpatcher.getDeltaValue(diffValue)
          if (deltaValue === undefined && diffValue[0].name)
            actions.push({
              action: 'removeAttributeDefinition',
              name: diffValue[0].name,
            })
        }
      }
    }
  })
  return actions
}
