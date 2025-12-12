from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _BaseModel(BaseModel):
    model_config = ConfigDict(
        # Accepts camelCase js ipc arguments for snake_case python fields.
        #
        # See: <https://docs.pydantic.dev/2.10/concepts/alias/#using-an-aliasgenerator>
        alias_generator=to_camel,
        # Allow constructing models using snake_case field names in Python
        # when aliases are defined via alias_generator (camelCase for JS).
        populate_by_name=True,
        # By default, pydantic allows unknown fields,
        # which results in TypeScript types having `[key: string]: unknown`.
        #
        # See: <https://docs.pydantic.dev/2.10/concepts/models/#extra-data>
        extra="forbid",
    )
