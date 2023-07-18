import { Avatar, Flex, Text } from "@100mslive/react-ui";

export const VoterList = ({ voters }) => {
  return voters.map((voter, index) => (
    <Flex
      align="center"
      key={`${voter}-${index}`}
      css={{ gap: "$4", py: "$2" }}
    >
      <Avatar
        name={voter}
        css={{
          position: "relative",
          transform: "unset",
          fontSize: "$tiny",
          size: "$9",
          p: "$4",
        }}
      />
      <Text
        variant="xs"
        css={{ color: "$textMedEmp", fontWeight: "$semiBold" }}
      >
        {voter}
      </Text>
    </Flex>
  ));
};